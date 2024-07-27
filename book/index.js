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

  const userAlias = event.detail.userAlias;
  if (!userAlias) {
    const errorMsg = "Received even without userAlias. Aborting";
    await logging.error(errorMsg);
    throw new Error(errorMsg);
  }

  const classDetails = event.detail.class;

  await logging.debug(
    `Received event of type=${event["detail-type"]} from source=${event.source} with id=${event.id}.\nTrying to book class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate} for userAlias=${userAlias} ...`,
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

    return;
  }

  const userCredentials = await utils.getUserCredentials(userAlias);

  let loginData = await gymApiClient.login(
    userCredentials.loginUsername,
    userCredentials.loginPassword,
  );

  const bookClassRequest = {
    method: "POST",
    url: `${BOOKING_API_BASE_URI}/core/calendarevent/${classDetails.id}/book`,
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
    data: {
      partitionDate: classDetails.partitionDate,
      userId: userCredentials.userId,
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
      userAlias,
      classDetails,
      bookClassResponse.data.errors,
    );

    return;
  }

  logging.debug(
    `Successfully booked class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate}`,
  );
  await publishBookingCompletedEvent(userAlias, classDetails);
};

/**
 * Used to send a ClassBookingCompleted event to represent a successful booking
 * @param {*} userAlias
 * @param {*} classDetails
 * @returns
 */
async function publishBookingCompletedEvent(userAlias, classDetails) {
  const classBookingCompletedEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.book",
        DetailType: "ClassBookingCompleted",
        Detail: JSON.stringify({
          userAlias: userAlias,
          class: {
            id: classDetails.id,
            name: classDetails.name,
            startDate: classDetails.startDate,
          },
        }),
      },
    ],
  };

  return await putEvent(classBookingCompletedEvent);
}

/**
 * Used to send a ClassBookingFailed event to represent a failed booking
 * @param {*} userAlias
 * @param {*} classDetails
 * @param {*} errors the errors array
 * @returns
 */
async function publishBookingFailedEvent(userAlias, classDetails, errors) {
  const classBookingCompletedEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.book",
        DetailType: "ClassBookingFailed",
        Detail: JSON.stringify({
          userAlias: userAlias,
          class: {
            id: classDetails.id,
            name: classDetails.name,
            startDate: classDetails.startDate,
          },
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
