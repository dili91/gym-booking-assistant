const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const eventBridgeClient = new EventBridgeClient();

const utils = require("/opt/nodejs/utils");
const logging = require("/opt/nodejs/logging");
const gymApiClient = require("/opt/nodejs/gymApiClient");

const BOOKING_API_BASE_URI = "https://api-exerp.mywellness.com";

exports.handler = async (event) => {
  const classDetails = event.details;

  logging.debug(
    `Received event of type=${event['detail-type']} from source=${event.source} with id=${event.id}.\nTrying to book class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate} ...`,
  );

  //TODO: can these safely come on event?
  const LOGIN_USERNAME = await utils.getSecret("loginUsername");
  const LOGIN_PASSWORD = await utils.getSecret("loginPassword");
  const USER_ID = await utils.getSecret("userId");

  let loginData = await gymApiClient.login(LOGIN_USERNAME, LOGIN_PASSWORD);

  //TODO in future: get class detail. Need to poll till BookingInfo.bookingUserStatus is CanBook

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

    await publishBookingCompletedEvent(classDetails.id, classDetails.partitionDate, {
      booked: false,
      errors: bookClassResponse.data.errors,
    });

    return;
  }

  logging.debug(
    `Successfully booked class with id=${classDetails.id} and partitionDate=${classDetails.partitionDate}`,
  );
  await publishBookingCompletedEvent(classDetails.id, classDetails.partitionDate, {
    booked: true,
  });
};

async function publishBookingCompletedEvent(classId, partitionDate, result) {
  const classBookingCompletedEvent = {
    Entries: [
      {
        Time: new Date(),
        Source: "GymBookingAssistant.book",
        DetailType: "ClassBookingCompleted",
        Detail: JSON.stringify({
          classId: classId,
          partitionDate: partitionDate,
          result: result,
        }),
      },
    ],
  };

  const putEventResponse = await eventBridgeClient.send(
    new PutEventsCommand(classBookingCompletedEvent),
  );

  if (
    putEventResponse["$metadata"].httpStatusCode != 200 ||
    putEventResponse.FailedEntryCount > 0
  ) {
    logging.error(
      "There were one or more errors while publishing a ClassBookingCompleted event.",
    );
  }
}
