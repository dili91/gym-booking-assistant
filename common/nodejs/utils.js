const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");
const axios = require("axios");
const maskData = require("maskdata");

const logging = require("./logging.js");

const secretsManagerClient = new SecretsManagerClient();

// Holds the JSON secret returned by the AWS secret manager
let secret = null;

const RESPONSE_BODY_MAX_SIZE_LOGGED = 300;

const JSON_MASKING_CONFIG = {
  passwordFields: ["password"],
  emailFields: ["username"],
};

function truncateString(str, num) {
  if (str.length > num) {
    return str.slice(0, num) + "...";
  } else {
    return str;
  }
}

module.exports = {
  getEnvVariable: (name) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not defined`);
    }
    return value;
  },

  isResponseError: (response) => {
    return (
      response.status < 200 ||
      response.status >= 300 ||
      (response.data != null && response.data.errors != null)
    );
  },

  getSecret: async (name) => {
    if (!secret) {
      const secretValue = await secretsManagerClient.send(
        new GetSecretValueCommand({
          SecretId: "GymBookingAssistant",
        }),
      );

      secret = JSON.parse(secretValue.SecretString);
    }

    const value = secret[name];
    if (!value) {
      throw new Error(`Secret ${name} not found.`);
    }

    return value;
  },

  getHttpClient: () => {
    let client = axios.create();

    client.interceptors.request.use(async (request) => {
      const CLIENT_ID = await module.exports.getSecret("clientId");
      request.headers["x-mwapps-client"] = CLIENT_ID;
      return request;
    });

    client.interceptors.request.use(async (request) => {
      await logging.debug(
        `>>> ${request.method.toUpperCase()} ${request.url}
        \nParams: ${JSON.stringify(request.params, null, 2)}
        \nBody:
        \n${JSON.stringify(maskData.maskJSON2(request.data, JSON_MASKING_CONFIG), null, 2)}`,
      );
      return request;
    });

    client.interceptors.response.use(async (response) => {
      await logging.debug(
        `<<< ${response.status} ${response.request.method.toUpperCase()} ${response.config.url}
        \nBody:
        \n${truncateString(JSON.stringify(response.data, null, 2), RESPONSE_BODY_MAX_SIZE_LOGGED)}
        \n\n`,
      );
      return response;
    });

    return client;
  },
};
