const axios = require("axios");

const logging = require("./logging.js");
const utils = require("./utils.js");

axios.interceptors.request.use((request) => {
  logging.debug(
    `>>> ${request.method.toUpperCase()} ${request.url}\nParams: ${JSON.stringify(request.params, null, 2)}\nBody: ${JSON.stringify(request.data, null, 2)}`,
  );
  return request;
});

axios.interceptors.response.use((response) => {
  logging.debug(
    `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.request.url}\n${JSON.stringify(response.data, null, 2)}\n\n`,
  );
  return response;
});

axios.defaults.headers.common["x-mwapps-client"] =
  utils.getEnvVariable("CLIENT_ID");
axios.defaults.headers.common["Content-Type"] = "application/json";

module.exports = Object.freeze({
  CORE_API_BASE_URI: "https://services.mywellness.com",
  CALENDAR_API_BASE_URI: "https://calendar.mywellness.com/v2",
  SUBSCRIBED_EVENT_NAMES_TOKENS: ["Cycle"],
});
