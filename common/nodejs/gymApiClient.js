const axios = require("axios");
const maskData = require("maskdata");

const utils = require("./utils.js");
const logging = require("./logging.js");

const CORE_API_BASE_URI = "https://services.mywellness.com";
const CALENDAR_API_BASE_URI = "https://calendar.mywellness.com/v2";

const RESPONSE_BODY_MAX_SIZE_LOGGED = 30000;

const JSON_MASKING_CONFIG = {
  passwordFields: ["password"],
  uuidFields: ["data.userContext.credentialId", "data.credentialId"],
  emailFields: [
    "username",
    "data.userContext.accountUsername",
    "data.userContext.email",
  ],
  phoneFields: ["data.userContext.mobilePhoneNumber"],
  genericStrings: [
    {
      fields: [
        "token",
        "data.userContext.firstName",
        "data.userContext.address1",
        "data.userContext.lastName",
        "data.userContext.nickName",
        "data.userContext.birthDate",
        "data.userContext.displayBirthDate",
        "data.userContext.pictureUrl",
        "data.userContext.thumbPictureUrl",
      ],
    },
  ],
};

class GymApiClient {
  #loginUsername;
  #loginPassword;
  #httpClient;

  constructor(loginUsername, loginPassword) {
    this.#loginUsername = loginUsername;
    this.#loginPassword = loginPassword;
    this.#httpClient = this.#getHttpClient();
  }

  /**
   * Search classes
   * @param {} fromDate fromDate to consider
   * @returns the list of classes available
   */
  async searchClasses(fromDate) {
    const loginResponse = await this.#login(
      this.#loginUsername,
      this.#loginPassword,
    );

    const facilityId = await utils.getConfig("facilityId");
    const searchClassesRequest = {
      method: "GET",
      url: `${CALENDAR_API_BASE_URI}/enduser/class/search`,
      headers: {
        Authorization: `Bearer ${loginResponse.token}`,
      },
      params: {
        facilityId: facilityId,
        fromDate: fromDate.format("yyyyMMDD"),
        eventType: "Class",
      },
    };

    const searchClassesResponse =
      await this.#httpClient.request(searchClassesRequest);

    if (this.#isResponseError(searchClassesResponse)) {
      const errorMsg = `Unable to get classes: ${JSON.stringify(searchClassesResponse.data)}. Aborting`;

      throw new Error(errorMsg);
    }

    return searchClassesResponse.data;
  }

  async #login() {
    const applicationId = await utils.getConfig("applicationId");
    const loginDomain = await utils.getConfig("loginDomain");

    const loginRequest = {
      method: "POST",
      url: `${CORE_API_BASE_URI}/Application/${applicationId}/Login`,
      data: {
        domain: loginDomain,
        keepMeLoggedIn: true,
        username: this.#loginUsername,
        password: this.#loginPassword,
      },
    };

    const loginResponse = await this.#httpClient.request(loginRequest);

    if (this.#isResponseError(loginResponse)) {
      const errorMsg = `Unable to login: ${JSON.stringify(loginResponse.data)}. Aborting`;
      await logging.error(errorMsg);

      throw new Error(errorMsg);
    }

    return loginResponse.data;
  }

  #getHttpClient() {
    let client = axios.create();

    client.interceptors.request.use(async (request) => {
      const CLIENT_ID = await utils.getConfig("clientId");
      request.headers["x-mwapps-client"] = CLIENT_ID;
      return request;
    });

    client.interceptors.request.use(async (request) => {
      const maskedPayload = maskData.maskJSON2(
        request.data,
        JSON_MASKING_CONFIG,
      );
      await logging.debug(
        `>>> ${request.method.toUpperCase()} ${request.url}
        \nParams: ${JSON.stringify(request.params, null, 2)}
        \nBody:
        \n${JSON.stringify(maskedPayload, null, 2)}`,
      );
      return request;
    });

    client.interceptors.response.use(async (response) => {
      const maskedPayload = maskData.maskJSON2(
        response.data,
        JSON_MASKING_CONFIG,
      );
      await logging.debug(
        `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.config.url}
        \nBody:
        \n${utils.truncateString(JSON.stringify(maskedPayload, null, 2), RESPONSE_BODY_MAX_SIZE_LOGGED)}
        \n\n`,
      );
      return response;
    });

    return client;
  }

  #isResponseError(response) {
    return (
      response.status < 200 ||
      response.status >= 300 ||
      (response.data != null && response.data.errors != null)
    );
  }
}

module.exports = {
  login: async function (username, password) {
    const applicationId = await utils.getConfig("applicationId");
    const loginDomain = await utils.getConfig("loginDomain");

    const loginRequest = {
      method: "POST",
      url: `${CORE_API_BASE_URI}/Application/${applicationId}/Login`,
      data: {
        domain: loginDomain,
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

  /**
   * Initialize the GymApi client to be used by the app
   * @param {string} loginUsername the username of the user
   * @param {string} loginPassword the password of the user
   * @returns the Gym API client instance
   */
  init: function (loginUsername, loginPassword) {
    return new GymApiClient(loginUsername, loginPassword);
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
      const maskedPayload = maskData.maskJSON2(
        request.data,
        JSON_MASKING_CONFIG,
      );
      await logging.debug(
        `>>> ${request.method.toUpperCase()} ${request.url}
        \nParams: ${JSON.stringify(request.params, null, 2)}
        \nBody:
        \n${JSON.stringify(maskedPayload, null, 2)}`,
      );
      return request;
    });

    client.interceptors.response.use(async (response) => {
      const maskedPayload = maskData.maskJSON2(
        response.data,
        JSON_MASKING_CONFIG,
      );
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
