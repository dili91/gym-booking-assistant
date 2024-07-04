const utils = require("./utils.js");
const logging = require("./logging.js");

const httpClient = utils.getHttpClient();

const CORE_API_BASE_URI = "https://services.mywellness.com";

module.exports = {
  login: async function (username, password) {
    const APPLICATION_ID = await utils.getSecret("applicationId");
    const LOGIN_DOMAIN = await utils.getSecret("loginDomain");

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

    const loginResponse = await httpClient.request(loginRequest);

    if (utils.isResponseError(loginResponse)) {
      await logging.error(
        "Unable to login. stopping. Reason: " +
          JSON.stringify(loginResponse.data),
      );
      process.exit(1);
    }

    return loginResponse.data;
  },
};
