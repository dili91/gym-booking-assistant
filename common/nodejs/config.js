const axios = require("axios");
const maskData = require("maskdata");

const logging = require("./logging.js");
const utils = require("./utils");

const RESPONSE_BODY_MAX_SIZE_LOGGED = 300;

const JSON_MASKING_CONFIG = {
  passwordFields: ["password"],
  emailFields: ["username"],
};

axios.interceptors.request.use(async (request) => {
  const CLIENT_ID = await utils.getSecret("clientId");
  request.headers["x-mwapps-client"] = CLIENT_ID;
  return request;
});

axios.interceptors.request.use((request) => {
  logging.debug(
    `>>> ${request.method.toUpperCase()} ${request.url}
    \nParams: ${JSON.stringify(request.params, null, 2)}
    \nBody:
    \n${JSON.stringify(maskData.maskJSON2(request.data, JSON_MASKING_CONFIG), null, 2)}`,
  );
  return request;
});

axios.interceptors.response.use((response) => {
  logging.debug(
    `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.config.url}
    \nBody:
    \n${truncateString(JSON.stringify(response.data, null, 2), RESPONSE_BODY_MAX_SIZE_LOGGED)}
    \n\n`,
  );
  return response;
});

function truncateString(str, num) {
  if (str.length > num) {
    return str.slice(0, num) + "...";
  } else {
    return str;
  }
}
