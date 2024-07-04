const dateFormatter = require("date-fns-tz");
const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const eventBridgeClient = new EventBridgeClient();

const {
  SchedulerClient,
  CreateScheduleCommand,
  FlexibleTimeWindowMode,
  ActionAfterCompletion,
} = require("@aws-sdk/client-scheduler");
const schedulerClient = new SchedulerClient();

const {
  LambdaClient,
  AddPermissionCommand,
} = require("@aws-sdk/client-lambda");
const lambdaClient = new LambdaClient();

const utils = require("/opt/nodejs/utils");
const logging = require("/opt/nodejs/logging");
const gymApiClient = require("/opt/nodejs/gymApiClient");

//TODO: move into module
const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";

const SUBSCRIBED_EVENT_NAMES_TOKENS = ["Cycle"];

const BOOK_LAMBDA_FUNCTION_ARN =
  "arn:aws:lambda:eu-south-1:097176176455:function:GymBookingAssistant_Book";
const EVENT_BRIDGE_SCHEDULER_ROLE_ARN =
  "arn:aws:iam::097176176455:role/EventBridgeSchedulerRole";

exports.handler = async (event) => {
  const LOGIN_USERNAME = await utils.getSecret("loginUsername");
  const LOGIN_PASSWORD = await utils.getSecret("loginPassword");

  let loginData = await gymApiClient.login(LOGIN_USERNAME, LOGIN_PASSWORD);

  // Search all classes that match my criteria of interest
  const FACILITY_ID = await utils.getSecret("facilityId");
  const searchClassesRequest = {
    method: "GET",
    url: `${CALENDAR_API_BASE_URI}/enduser/class/search`,
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
    params: {
      facilityId: FACILITY_ID,
      fromDate: dateFormatter.formatInTimeZone(
        new Date(),
        "Europe/Rome",
        "yyyyMMdd",
      ),
      eventType: "Class",
    },
  };
  const searchClassesResponse = await utils
    .getHttpClient()
    .request(searchClassesRequest);

  if (utils.isResponseError(searchClassesResponse)) {
    logging.error("Unable to get classes. stopping");
    process.exit(1);
  }

  const filteredEvents = searchClassesResponse.data.filter(
    (e) =>
      // Include only the events whose names include subscribed tokens
      SUBSCRIBED_EVENT_NAMES_TOKENS.some((s) =>
        e.name.toLowerCase().includes(s.toLowerCase()),
      ) &&
      // excludes the classes booked already
      e.isParticipant != true &&
      // excludes the classes that can't be booked for some reason
      e.bookingInfo.bookingUserStatus != "CannotBook" &&
      e.bookingInfo.bookingUserStatus != "BookingClosed",
  );

  logging.debug(
    `Found ${filteredEvents.length} events of the categories of interest (${SUBSCRIBED_EVENT_NAMES_TOKENS}).`,
  );

  for (const e of filteredEvents) {
    switch (e.bookingInfo.bookingUserStatus) {
      case "CanBook":
        await publishBookingAvailableEvent(e);
        break;
      case "WaitingBookingOpensPremium":
        await scheduleFutureBooking(e);
        break;
      default:
        logging.error(
          `Unexpected status for class ${e.name} with id ${e.id}: ${e.bookingInfo.bookingUserStatus}. Skipping.`,
        );
        return;
    }
  }
};

async function publishBookingAvailableEvent(e) {
  logging.debug(
    `Booking for class ${e.name} with id=${e.id} should happen immediately.`,
  );
  const classBookingAvailableEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.scan",
        DetailType: "ClassBookingAvailable",
        Detail: JSON.stringify({
          class: {
            id: e.id,
            name: e.name,
            startDate: e.startDate,
            endDate: e.endDate,
            needsStation: e.hasLayout,
          },
        }),
      },
    ],
  };

  const putEventResponse = await eventBridgeClient.send(
    new PutEventsCommand(classBookingAvailableEvent),
  );

  if (
    putEventResponse["$metadata"].httpStatusCode != 200 ||
    putEventResponse.FailedEntryCount > 0
  ) {
    logging.error(
      "There were one or more errors while publishing a ClassBookingAvailable event.",
    );
  }
}

async function scheduleFutureBooking(e) {
  logging.debug(
    `Booking for class ${e.name} with id=${e.id} should be scheduled on ${e.bookingInfo.bookingOpensOn}`,
  );

  let bookingOpensOnUTC = new Date(e.bookingInfo.bookingOpensOn)
    .toISOString()
    .slice(0, -5);

  const schedule = {
    Name: `ScheduleBooking_${e.id}`,
    Description: `${e.name}-${e.startDate}`,
    ScheduleExpression: `at(${bookingOpensOnUTC})`,
    Target: {
      Arn: BOOK_LAMBDA_FUNCTION_ARN,
      RoleArn: EVENT_BRIDGE_SCHEDULER_ROLE_ARN,
      Input: JSON.stringify(e),
    },
    ActionAfterCompletion: ActionAfterCompletion.DELETE,
    FlexibleTimeWindow: {
      Mode: FlexibleTimeWindowMode.OFF,
    },
  };

  const createScheduleResponse = await schedulerClient.send(
    new CreateScheduleCommand(schedule),
  );

  if (createScheduleResponse["$metadata"].httpStatusCode != 200) {
    logging.error(
      "There were one or more errors while creating a booking schedule.",
    );
  }
}
