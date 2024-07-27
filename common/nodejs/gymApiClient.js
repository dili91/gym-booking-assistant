const axios = require("axios");
const maskData = require("maskdata");

const utils = require("./utils.js");
const logging = require("./logging.js");

const CORE_API_BASE_URI = "https://services.mywellness.com";
const RESPONSE_BODY_MAX_SIZE_LOGGED = 300;

const JSON_MASKING_CONFIG = {
  passwordFields: ["password"],
  uuidFields:  ["data.userContext.credentialId", "data.credentialId"],
  emailFields: ["username", "data.userContext.accountUsername", "data.userContext.email"],
  phoneFields: ['data.userContext.mobilePhoneNumber'],
  genericStrings: [
    { fields: [
      "token", "data.userContext.firstName", "data.userContext.address1",
      "data.userContext.lastName", "data.userContext.nickName", "data.userContext.birthDate",
      "data.userContext.displayBirthDate", "data.userContext.pictureUrl", "data.userContext.thumbPictureUrl"]
    },
  ]
};

module.exports = {
  login: async function (username, password) {
    const APPLICATION_ID = await utils.getConfig("applicationId");
    const LOGIN_DOMAIN = await utils.getConfig("loginDomain");

    const loginRequest = {
      method: "POST",
      url: `${CORE_API_BASE_URI}/Application/${APPLICATION_ID}/Login`,
      data: {
        domain: LOGIN_DOMAIN,
        keepMeLoggedIn: true,
        username: username,
        password: password,
      },
    };

    const loginResponse = await module.exports
      .getHttpClient()
      .request(loginRequest);

    if (module.exports.isResponseError(loginResponse)) {
      const errorMsg = `Unable to login: ${JSON.stringify(loginResponse.data)}. Aborting`;
      await logging.error(errorMsg);

      throw new Error(errorMsg);
    }

    return loginResponse.data;
  },

  //TODO: ultimately remove
  getHttpClient: function () {
    let client = axios.create();

    client.interceptors.request.use(async (request) => {
      const CLIENT_ID = await utils.getConfig("clientId");
      request.headers["x-mwapps-client"] = CLIENT_ID;
      return request;
    });

    client.interceptors.request.use(async (request) => {
      const maskedPayload = maskData.maskJSON2(request.data, JSON_MASKING_CONFIG);
      await logging.debug(
        `>>> ${request.method.toUpperCase()} ${request.url}
        \nParams: ${JSON.stringify(request.params, null, 2)}
        \nBody:
        \n${JSON.stringify(maskedPayload, null, 2)}`,
      );
      return request;
    });

    client.interceptors.response.use(async (response) => {
      const maskedPayload = maskData.maskJSON2(response.data, JSON_MASKING_CONFIG);
      await logging.debug(
        `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.config.url}
        \nBody:
        \n${utils.truncateString(JSON.stringify(maskedPayload, null, 2), RESPONSE_BODY_MAX_SIZE_LOGGED)}
        \n\n`,
      );
      return response;
    });

    return client;
  },

  //TODO: make this private in the end
  isResponseError: (response) => {
    return (
      response.status < 200 ||
      response.status >= 300 ||
      (response.data != null && response.data.errors != null)
    );
  },
};
