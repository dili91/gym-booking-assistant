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
  logging.debug(
    `Trying to book class with id=${event.id} and partitionDate=${event.partitionDate} ...`,
  );

  //TODO: can these safely come on event?
  const LOGIN_USERNAME = await utils.getSecret("loginUsername");
  const LOGIN_PASSWORD = await utils.getSecret("loginPassword");
  const USER_ID = await utils.getSecret("userId");

  let loginData = await gymApiClient.login(LOGIN_USERNAME, LOGIN_PASSWORD);

  //TODO in future: get class detail. Need to poll till BookingInfo.bookingUserStatus is CanBook

  const bookClassRequest = {
    method: "POST",
    url: `${BOOKING_API_BASE_URI}/core/calendarevent/${event.id}/book`,
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
    data: {
      partitionDate: event.partitionDate,
      userId: USER_ID,
    },
  };

  const bookClassResponse = await gymApiClient
    .getHttpClient()
    .request(bookClassRequest);

  if (gymApiClient.isResponseError(bookClassResponse)) {
    logging.error(
      `Unable to book class with id=${event.id} and partitionDate=${event.partitionDate}. Errors=${JSON.stringify(bookClassResponse.data.errors)}`,
    );

    await publishBookingCompletedEvent(event.id, event.partitionDate, {
      booked: false,
      errors: bookClassResponse.data.errors,
    });

    return;
  }

  logging.debug(
    `Successfully booked class with id=${event.id} and partitionDate=${event.partitionDate}`,
  );
  await publishBookingCompletedEvent(event.id, event.partitionDate, {
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
