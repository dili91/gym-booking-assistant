const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");
const moment = require("moment");
var itParam = require("mocha-param");

const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
var utils = require("../utils");

const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");

const { expect } = require("chai");

describe("Utils", function () {
  afterEach(() => {
    sandbox.restore();
  });

  describe("getConfig", function () {
    let parametersStoreStub;

    it("Should yield a config value and avoid calling AWS ParametersStore on subsequent calls", async function () {
      // Arrange
      // Stub for the interactions with AWS Parameters Store
      parametersStoreStub = sandbox.stub(SSMClient.prototype, "send");
      const appId = uuidv4();
      const clientId = uuidv4();
      parametersStoreStub.returns({
        Parameter: {
          Type: "String",
          Value: `{"applicationId":"${appId}", "clientId":"${clientId}"}`,
        },
      });

      // Act
      let actualAppId = await utils.getConfig("applicationId");
      let actualClientId = await utils.getConfig("clientId");

      // Assert
      sandbox.assert.calledOnceWithMatch(
        parametersStoreStub,
        sandbox.match(function (command) {
          return (
            command instanceof GetParameterCommand &&
            command.input.Name == "GymBookingAssistant"
          );
        }),
      );
      expect(actualAppId).to.equal(appId);
      expect(actualClientId).to.equal(clientId);
    });
  });

  describe("getUserCredentials", function () {
    let secretsManagerStub;

    it("Should yield user credentials coming from AWS Secrets manager", async function () {
      // Arrange
      secretsManagerStub = sandbox.stub(SecretsManagerClient.prototype, "send");
      const userAlias = "jdoe";
      const loginUsername = "jdoe@email.com";
      const loginPassword = uuidv4();
      const userId = uuidv4();
      secretsManagerStub.returns({
        SecretString: `{"loginUsername":"${loginUsername}", "loginPassword":"${loginPassword}", "userId":"${userId}"}`,
      });

      // Act
      const userCredentials = await utils.getUserCredentials(userAlias);

      // Assert
      sandbox.assert.calledOnceWithMatch(
        secretsManagerStub,
        sandbox.match(function (command) {
          return (
            command instanceof GetSecretValueCommand &&
            command.input.SecretId ==
              `GymBookingAssistant/Credentials/${userAlias}`
          );
        }),
      );
      expect(userCredentials.loginUsername).to.equal(loginUsername);
      expect(userCredentials.loginPassword).to.equal(loginPassword);
      expect(userCredentials.userId).to.equal(userId);
    });

    it("Should invoke AWS Secrets manager every time", async function () {
      // Arrange
      secretsManagerStub = sandbox.stub(SecretsManagerClient.prototype, "send");
      const userAlias = "jdoe";
      const loginUsername = "jdoe@email.com";
      const loginPassword = uuidv4();
      const userId = uuidv4();

      secretsManagerStub.returns({
        SecretString: `{"loginUsername":"${loginUsername}", "loginPassword":"${loginPassword}", "userId":"${userId}"}`,
      });

      // Act
      await utils.getUserCredentials(userAlias);
      await utils.getUserCredentials(userAlias);

      // Assert
      sandbox.assert.calledTwice(secretsManagerStub);
    });
  });

  describe("truncateString", function () {
    itParam(
      "Should truncate ${value.input} after ${value.chars} chars and be equal to ${value.expected}",
      [
        //nowCET makes the test stable over time
        {
          input: "Andrea",
          chars: 4,
          expected: "Andr...",
        },
        {
          input: "Andrea",
          chars: 0,
          expected: "...",
        },
        {
          input: "Andrea",
          chars: 10,
          expected: "Andrea",
        },
      ],
      function (value) {
        // Act
        const truncatedString = utils.truncateString(value.input, value.chars);

        // Assert
        expect(truncatedString).to.equal(value.expected);
      },
    );
  });

  describe("stringToDateCET", function () {
    it("Should convert a date string without timezone into a Moment date in CET format", function () {
      // Act
      const dateCet = utils.stringToDateCET("2024-07-27T00:30:00");

      // Assert
      expect(dateCet.format("YYYY/MM/DD")).to.equal("2024/07/27");
      expect(dateCet.tz()).to.equal("Europe/Rome");
    });

    it("Should throw an error if date string contains timezone indicators", function () {
      try {
        // Act
        const dateCet = utils.stringToDateCET("2024-07-27T00:30:00Z");
      } catch (error) {
        // Assert
        expect(error).to.be.an("error");
        expect(error.name).to.be.equal("Error");
        expect(error.message).to.be.equal(
          "Input date string should not contain timezone info!",
        );
      }
    });
  });
});
