
const axios = require("axios");
const dateFormatter = require("date-fns-tz");

const logging = require("./logging.js");
const utils = require("./utils.js");
const config = require("./config.js");

exports.handler = async (event) => {
  // First of all login
  const loginRequest = {
    method: "POST",
    url: `${config.CORE_API_BASE_URI}/Application/${utils.getEnvVariable("APPLICATION_ID")}/Login`,
    data: {
      domain: "it.virginactive",
      keepMeLoggedIn: true,
      password: utils.getEnvVariable("LOGIN_PASSWORD"),
      username: utils.getEnvVariable("LOGIN_USERNAME"),
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
    url: `${config.CALENDAR_API_BASE_URI}/enduser/class/search`,
    headers: {
      Authorization: `Bearer ${loginResponse.data.token}`,
    },
    params: {
      facilityId: utils.getEnvVariable("FACILITY_ID"),
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
      config.SUBSCRIBED_EVENT_NAMES_TOKENS.some((s) =>
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

  filteredEvents.forEach((e) => {
    switch (e.bookingInfo.bookingUserStatus) {
      case "CanBook":
        logging.info(
          `Booking for class ${e.name} with id=${e.id} should happen immediately.`,
        );
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
  });
};
