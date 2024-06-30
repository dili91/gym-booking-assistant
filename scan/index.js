const axios = require("axios");
const dateFormatter = require("date-fns-tz");
const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const eventBridgeClient = new EventBridgeClient();

const logging = require("/opt/nodejs/logging");
const utils = require("/opt/nodejs/utils");
const config = require("/opt/nodejs/config");

const CORE_API_BASE_URI = "https://services.mywellness.com";
const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";
const SUBSCRIBED_EVENT_NAMES_TOKENS = ["Cycle"];

exports.handler = async (event) => {
  const APPLICATION_ID = await utils.getSecret("applicationId");
  const FACILITY_ID = await utils.getSecret("facilityId");
  const LOGIN_DOMAIN = await utils.getSecret("loginDomain");
  const LOGIN_USERNAME = await utils.getSecret("loginUsername");
  const LOGIN_PASSWORD = await utils.getSecret("loginPassword");

  // First of all login
  const loginRequest = {
    method: "POST",
    url: `${CORE_API_BASE_URI}/Application/${APPLICATION_ID}/Login`,
    data: {
      domain: LOGIN_DOMAIN,
      keepMeLoggedIn: true,
      password: LOGIN_PASSWORD,
      username: LOGIN_USERNAME,
    },
  };

  const loginResponse = await axios.request(loginRequest);

  if (utils.isResponseError(loginResponse)) {
    logging.error("Unable to login. stopping");
    process.exit(1);
  }

  // Search all classes that match my criteria of interest
  const searchClassesRequest = {
    method: "GET",
    url: `${CALENDAR_API_BASE_URI}/enduser/class/search`,
    headers: {
      Authorization: `Bearer ${loginResponse.data.token}`,
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
  const searchClassesResponse = await axios.request(searchClassesRequest);

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

  logging.info(`Found ${searchClassesResponse.data.length} classes.`);
  logging.info(
    `Found ${filteredEvents.length} events of the categories of interest (${config.SUBSCRIBED_EVENT_NAMES_TOKENS}).`,
  );

  for (const e of filteredEvents) {
    switch (e.bookingInfo.bookingUserStatus) {
      case "CanBook":
        logging.info(
          `Booking for class ${e.name} with id=${e.id} should happen immediately.`,
        );
        const classBookingAvailableEvent = {
          // PutEventsRequest
          Entries: [
            // PutEventsRequestEntryList // required
            {
              // PutEventsRequestEntry
              Time: new Date(),
              Source: "GymBookingAssistant.scan",
              DetailType: "ClassBookingAvailable",
              Detail: JSON.stringify({
                class: {
                  id: e.id,
                  name: e.name,
                },
              }),
            },
          ],
        };
        logging.info(
          `Publishing event=${JSON.stringify(classBookingAvailableEvent, null, 2)}.`,
        );
        const putEventResponse = await eventBridgeClient.send(
          new PutEventsCommand(classBookingAvailableEvent),
        );
        logging.info(`Outcome: ${JSON.stringify(putEventResponse, null, 2)}.`);
        break;
      case "WaitingBookingOpensPremium":
        logging.info(
          `Booking for class ${e.name} with id=${e.id} should be scheduled on ${e.bookingInfo.bookingOpensOn}`,
        );
        break;
      default:
        logging.info(
          `Unexpected status for class ${e.name} with id ${e.id}: ${e.bookingInfo.bookingUserStatus}. Skipping.`,
        );
        return;
    }
  }
};
