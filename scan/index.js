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

const utils = require("/opt/nodejs/utils");
const logging = require("/opt/nodejs/logging");
const gymApiClient = require("/opt/nodejs/gymApiClient");

//TODO: move into module
const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";

const SUBSCRIBED_EVENT_NAMES_TOKENS = ["Cycle Spirit"];

//TODO: Cleanup
const BOOK_LAMBDA_FUNCTION_ARN =
  "arn:aws:lambda:eu-south-1:097176176455:function:GymBookingAssistant_Book";
const EVENT_BRIDGE_SCHEDULER_ROLE_ARN =
  "arn:aws:iam::097176176455:role/EventBridgeSchedulerRole";

exports.handler = async (event) => {
  //TODO: can these safely come on event?
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
  const searchClassesResponse = await gymApiClient
    .getHttpClient()
    .request(searchClassesRequest);

  if (gymApiClient.isResponseError(searchClassesResponse)) {
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
        // TODO: check cancellationMinutesInAdvance. I should avoid booking for classes than can't be un-booked to avoid penalties!
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

//TODO: refine event payload
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
        Detail: JSON.stringify(e),
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

//TODO: refine event payload
async function scheduleFutureBooking(e) {
  logging.debug(
    `Booking for class ${e.name} with id=${e.id} should be scheduled on ${e.bookingInfo.bookingOpensOn}`,
  );

  let bookingOpensOnUTC = new Date(e.bookingInfo.bookingOpensOn)
    .toISOString()
    .slice(0, -5);

  //TODO cleanup  
  // const schedule = {
  //   Name: `ScheduleBooking_${e.id}`,
  //   Description: `${e.name}-${e.startDate}`,
  //   ScheduleExpression: `at(${bookingOpensOnUTC})`,
  //   //TODO: change target to be an EventBridge event
  //   Target: {
  //     Arn: BOOK_LAMBDA_FUNCTION_ARN,
  //     RoleArn: EVENT_BRIDGE_SCHEDULER_ROLE_ARN,
  //     Input: JSON.stringify(e),
  //   },
  //   ActionAfterCompletion: ActionAfterCompletion.DELETE,
  //   FlexibleTimeWindow: {
  //     Mode: FlexibleTimeWindowMode.OFF,
  //   },
  // };

  const scheduleRequest = {
    Name: `ScheduleBooking_${e.id}`,
    Description: `${e.name}-${e.startDate}`,
    ScheduleExpression: `at(${bookingOpensOnUTC})`,
    Target: {
      // TODO: Arn and RoleArn are required, but what should be used?
      EventBridgeParameters: {
        Source: "GymBookingAssistant.scan",
        DetailType: "ClassBookingAvailable",
      },
      Input: JSON.stringify(e)
    },
    ActionAfterCompletion: ActionAfterCompletion.DELETE,
    FlexibleTimeWindow: {
      Mode: FlexibleTimeWindowMode.OFF,
    },
  };

  const createScheduleResponse = await schedulerClient.send(
    new CreateScheduleCommand(scheduleRequest),
  );

  if (createScheduleResponse["$metadata"].httpStatusCode != 200) {
    logging.error(
      "There were one or more errors while creating a booking schedule.",
    );
  }
}
