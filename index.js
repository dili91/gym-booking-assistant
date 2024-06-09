const logging = require("./logging.js");
const axios = require("axios");

axios.interceptors.request.use((request) => {
   logging.debug(
    `>>> ${request.method.toUpperCase()} ${request.url}\n${JSON.stringify(request.data, null, 2)}`,
  );
  return request;
});

axios.interceptors.response.use((response) => {
  logging.debug(
    `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.request.url}\n${JSON.stringify(response.data, null, 2)}\n\n`,
  );
  return response;
});

axios.defaults.headers.common["x-mwapps-client"] = getEnvVariable("CLIENT_ID");
axios.defaults.headers.common["Content-Type"] = "application/json";

const CORE_API_BASE_URI = "https://services.mywellness.com";
const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";
const SUBSCRIBED_EVENT_NAMES_TOKENS = ["Cycle"];

function getEnvVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not defined`);
  }
  return value;
}

function isResponseError(response) {
  return (
    response.status < 200 ||
    response.status >= 300 ||
    (response.data != null && response.data.errors != null)
  );
}

exports.handler = async (event) => {
  // First of all login
  const loginRequest = {
    method: "POST",
    url: `${CORE_API_BASE_URI}/Application/${getEnvVariable("APPLICATION_ID")}/Login`,
    data: {
      domain: "it.virginactive",
      keepMeLoggedIn: true,
      password: getEnvVariable("LOGIN_PASSWORD"),
      username: getEnvVariable("LOGIN_USERNAME"),
    },
  };

  const loginResponse = await axios.request(loginRequest);

  if (isResponseError(loginResponse)) {
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
      facilityId: getEnvVariable("FACILITY_ID"),
      fromDate: "20240609", // TODO: set to today
      //toDate: '20240612',
      eventType: "Class",
    },
  };
  const searchClassesResponse = await axios.request(searchClassesRequest);

  if (isResponseError(searchClassesResponse)) {
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
    `Found ${filteredEvents.length} events of the categories of interest (${SUBSCRIBED_EVENT_NAMES_TOKENS}).`,
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
