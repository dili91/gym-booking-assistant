const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const eventBridgeClient = new EventBridgeClient();

const utils = require("/opt/nodejs/utils");
const logging = require("/opt/nodejs/logging");
const gymApiClient = require("/opt/nodejs/gymApiClient");

const BOOKING_API_BASE_URI = "https://api-exerp.mywellness.com";
const EXTRA_TIME_CANCEL_BOOKING_IN_MINUTES = 60;

exports.handler = async (event) => {
  //TODO future improvements: anticipate the scheduling a bit and get class detail. Need to poll till BookingInfo.bookingUserStatus is CanBook

  const classDetails = event.detail;

  logging.debug(
    `Received event of type=${event["detail-type"]} from source=${event.source} with id=${event.id}.\nTrying to book class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate} ...`,
  );

  // Check class booking status. This should never be different from CanBook or WaitingBookingOpensPremium, but let's double check
  if (
    classDetails.bookingInfo.bookingUserStatus != "CanBook" &&
    classDetails.bookingInfo.bookingUserStatus != "WaitingBookingOpensPremium"
  ) {
    await logging.warn(
      `Booking rejected its status is${classDetails.bookingInfo.bookingUserStatus}`,
    );
    return;
  }

  // Check cancellationMinutesInAdvance. We should avoid booking for classes than can't be un-booked to avoid penalties!
  const startDateCET = utils.stringToDateCET(classDetails.startDate);
  const timeToClassStartInMinutes = startDateCET.diff(
    utils.nowCET(),
    "minutes",
  );

  const timeToCancelBookingMinutes =
    classDetails.bookingInfo.cancellationMinutesInAdvance +
    EXTRA_TIME_CANCEL_BOOKING_IN_MINUTES;
  const classCanBeCancelled =
    timeToClassStartInMinutes > timeToCancelBookingMinutes;

  if (!classCanBeCancelled) {
    await logging.warn(
      `Booking rejected to avoid penalties, because class could not be un-booked. startDate=${startDateCET} timeToClassStartInMinutes=${timeToClassStartInMinutes} timeToCancelBookingMinutes=${timeToCancelBookingMinutes}`,
    );

    //TODO: improve the definition of BookingFailed to cover both validation and external API errors, and then send those messages also in these cases
    return;
  }

  //TODO: can these safely come on event?
  const LOGIN_USERNAME = await utils.getSecret("loginUsername");
  const LOGIN_PASSWORD = await utils.getSecret("loginPassword");
  const USER_ID = await utils.getSecret("userId");

  let loginData = await gymApiClient.login(LOGIN_USERNAME, LOGIN_PASSWORD);

  const bookClassRequest = {
    method: "POST",
    url: `${BOOKING_API_BASE_URI}/core/calendarevent/${classDetails.id}/book`,
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
    data: {
      partitionDate: classDetails.partitionDate,
      userId: USER_ID,
    },
  };

  const bookClassResponse = await gymApiClient
    .getHttpClient()
    .request(bookClassRequest);

  if (gymApiClient.isResponseError(bookClassResponse)) {
    logging.error(
      `Unable to book class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate}. Errors=${JSON.stringify(bookClassResponse.data.errors)}`,
    );

    await publishBookingFailedEvent(
      classDetails.id,
      classDetails.partitionDate,
      bookClassResponse.data.errors,
    );

    return;
  }

  logging.debug(
    `Successfully booked class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate}`,
  );
  await publishBookingCompletedEvent(
    classDetails.id,
    classDetails.partitionDate,
  );
};

/**
 * Used to send an event represent a successful booking
 * @param {*} classId
 * @param {*} partitionDate
 * @param {*} result the underlying EventBridge putEvent API response
 */
async function publishBookingCompletedEvent(classId, partitionDate) {
  const classBookingCompletedEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.book",
        DetailType: "ClassBookingCompleted",
        Detail: JSON.stringify({
          classId: classId,
          partitionDate: partitionDate,
        }),
      },
    ],
  };

  return await putEvent(classBookingCompletedEvent);
}

/**
 * Used to send an event represent a failed booking
 * @param {*} classId
 * @param {*} partitionDate
 * @param {*} result the underlying EventBridge putEvent API response
 */
async function publishBookingFailedEvent(classId, partitionDate, errors) {
  const classBookingCompletedEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.book",
        DetailType: "ClassBookingFailed",
        Detail: JSON.stringify({
          classId: classId,
          partitionDate: partitionDate,
          errors: errors,
        }),
      },
    ],
  };

  return await putEvent(classBookingCompletedEvent);
}

/**
 * Internal utility used to put an event on EventBridge. Used for both successful and failed bookings
 * @param {} event the event to send
 * @returns the putEvent API response
 */
async function putEvent(event) {
  const putEventResponse = await eventBridgeClient.send(
    new PutEventsCommand(event),
  );

  if (
    putEventResponse["$metadata"].httpStatusCode != 200 ||
    putEventResponse.FailedEntryCount > 0
  ) {
    logging.error(
      "There were one or more errors while publishing a ClassBookingCompleted event.",
    );
  }
  return putEventResponse;
}
