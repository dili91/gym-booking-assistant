//TODO: can I just use moment?
const dateFormatter = require("date-fns-tz");
const moment = require("moment-timezone");

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

const SEARCH_CRITERIA = {
  classNames: ["Cycle Spirit"],
  hourRangesCET: [
    {
      start: "08:00:00",
      end: "10:00:30",
    },
    {
      start: "18:00:00",
      end: "21:00:00",
    },
  ],
  // 0 Sunday, 6 Saturday
  days: [1, 2, 3, 4, 5],
};

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

  // It seems not possible to filter classes of interest via an API call. So we need to fetch them first
  // and retrospectively ignore some of those.
  const filteredEvents = searchClassesResponse.data
    .filter(
      (e) =>
        // excludes the classes booked already
        e.isParticipant != true &&
        // excludes the classes that can't be booked for some reason
        e.bookingInfo.bookingUserStatus != "CannotBook" &&
        e.bookingInfo.bookingUserStatus != "BookingClosed",
    )
    .filter((e) =>
      SEARCH_CRITERIA.classNames.some((c) =>
        e.name.toLowerCase().includes(c.toLowerCase()),
      ),
    )
    .filter((e) =>
      // Class should be taken in one of the days of interest
      SEARCH_CRITERIA.days.includes(utils.stringToDateCET(e.startDate).day()),
    )
    .filter((e) => {
      // startDate time should fall in one of the hour ranges
      const timeFormat = "HH:mm:ss";
      // this parses the class start timestamp in $timeFormat
      const classStartDateTime = utils
        .stringToDateCET(e.startDate)
        .format(timeFormat);
      // this one builds a new date attaching the above time portion to today's date portion
      // this makes sure that when comparing timestamps results are not spoiled by different days
      const adjustedClassStartDate = moment(classStartDateTime, timeFormat);

      // this returns true if the class' startDateTime if there's at least a match
      return SEARCH_CRITERIA.hourRangesCET.some((hr) => {
        const rangeStartTime = moment(hr.start, timeFormat);
        const rangeEndTime = moment(hr.end, timeFormat);

        //TODO: cleanup
        // console.log(
        //   `${adjustedClassStartDate} | ${rangeStartTime} - ${rangeEndTime} -> ${adjustedClassStartDate.isBetween(rangeStartTime, rangeEndTime)}`,
        // );

        return adjustedClassStartDate.isBetween(rangeStartTime, rangeEndTime);
      });
    });

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

  const scheduleRequest = {
    Name: `ScheduleBooking_${e.id}`,
    Description: `Class: ${e.name} - Starts at: ${e.startDate}`,
    ScheduleExpression: `at(${bookingOpensOnUTC})`,
    Target: {
      Arn: "arn:aws:events:eu-south-1:097176176455:event-bus/default",
      RoleArn:
        "arn:aws:iam::097176176455:role/service-role/GymBookingAssistantEventBridgeRole",
      Source: "GymBookingAssistant.scan",
      DetailType: "ClassBookingAvailable",
      Input: JSON.stringify(e),
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
