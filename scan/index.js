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

const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";

const SEARCH_CRITERIA = {
  classNames: ["Pilates"],
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

exports.handler = async (event) => {
  const userAlias = event.detail.userAlias;
  if (!userAlias) {
    const errorMsg = "Received even without userAlias. Aborting";
    await logging.error(errorMsg);

    throw new Error(errorMsg);
  }

  const userCredentials = await utils.getUserCredentials(userAlias);
  let loginData = await gymApiClient.login(
    userCredentials.loginUsername,
    userCredentials.loginPassword,
  );

  const facilityId = await utils.getConfig("facilityId");

  // Search all classes that match my criteria of interest
  const searchClassesRequest = {
    method: "GET",
    url: `${CALENDAR_API_BASE_URI}/enduser/class/search`,
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
    params: {
      facilityId: facilityId,
      fromDate: utils.nowCET().format("yyyyMMDD"),
      eventType: "Class",
    },
  };
  const searchClassesResponse = await gymApiClient
    .getHttpClient()
    .request(searchClassesRequest);

  if (gymApiClient.isResponseError(searchClassesResponse)) {
    const errorMsg = `Unable to get classes: ${JSON.stringify(searchClassesResponse.data)}. Aborting`;
    logging.error(errorMsg);

    throw new Error(errorMsg);
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

        return adjustedClassStartDate.isBetween(rangeStartTime, rangeEndTime);
      });
    });

  logging.debug(
    `Found ${filteredEvents.length} events of the categories of interest.`,
  );

  for (const e of filteredEvents) {
    switch (e.bookingInfo.bookingUserStatus) {
      case "CanBook":
        logging.debug(
          `Booking for class ${e.name} with id=${e.id} should happen immediately.`,
        );
        await publishBookingAvailableEvent(userAlias, e);
        break;
      case "WaitingBookingOpensPremium":
        logging.debug(
          `Booking for class ${e.name} with id=${e.id} should be scheduled on ${e.bookingInfo.bookingOpensOn}`,
        );
        await scheduleFutureBooking(userAlias, e);
        break;
      default:
        logging.error(
          `Unexpected status for class ${e.name} with id ${e.id}: ${e.bookingInfo.bookingUserStatus}. Skipping.`,
        );
        return;
    }
  }
};

async function publishBookingAvailableEvent(userAlias, classDetails) {
  const classBookingAvailableEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.scan",
        DetailType: "ClassBookingAvailable",
        Detail: JSON.stringify(
          craftClassBookingAvailableEventPayload(userAlias, classDetails),
        ),
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

async function scheduleFutureBooking(userAlias, classDetails) {
  let bookingOpensOnUTC = new Date(classDetails.bookingInfo.bookingOpensOn)
    .toISOString()
    .slice(0, -5);

  const scheduleRequest = {
    Name: `ScheduleBooking_${classDetails.id}`,
    Description: `Class: ${classDetails.name} - Starts at: ${classDetails.startDate}`,
    ScheduleExpression: `at(${bookingOpensOnUTC})`,
    Target: {
      Arn: "arn:aws:events:eu-south-1:097176176455:event-bus/default",
      RoleArn:
        "arn:aws:iam::097176176455:role/service-role/GymBookingAssistantEventBridgeRole",
      EventBridgeParameters: {
        DetailType: "ClassBookingAvailable",
        Source: "GymBookingAssistant.scan",
      },
      // The schedule event is one that contains the userAlias and a slimmed-down
      // version of the class object coming from the Gym API
      Input: JSON.stringify(
        craftClassBookingAvailableEventPayload(userAlias, classDetails),
      ),
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

/**
 * An internal utility that helps building ClassBookingAvailable events:
 * {
 * id: '9a809b9e-8b31-461c-9cf2-ecd1aafa6ff1',
 * 'detail-type': 'ClassBookingAvailable',
 * source: 'GymBookingAssistant.scan',
 * detail: {
 *   userAlias: '3b5b8ad6-bf38-488f-95b7-f1fdf9540aa1',
 *   class: {
 *     id: '4e1ba4c5-b447-4d85-a2e4-c461080cc34c',
 *     name: 'Class name',
 *     partitionDate: '20240727',
 *     startDate: '2024-07-27T18:54:59',
 *     bookingInfo: {
 *      cancellationMinutesInAdvance: 120,
 *      bookingUserStatus:"CanBook"
 *     }
 *   }
 * }
}
 * @param {string} userAlias User alias representing the user that will be impersonated
 * @param {JSON} classDetails Class object as returned by the Gym API
 */
function craftClassBookingAvailableEventPayload(userAlias, classDetails) {
  return {
    userAlias: userAlias,
    class: {
      id: classDetails.id,
      name: classDetails.name,
      partitionDate: classDetails.partitionDate,
      startDate: classDetails.startDate,
      bookingInfo: {
        cancellationMinutesInAdvance:
          classDetails.bookingInfo.cancellationMinutesInAdvance,
        bookingUserStatus: classDetails.bookingInfo.bookingUserStatus,
      },
    },
  };
}
