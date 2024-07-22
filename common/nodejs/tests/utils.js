const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

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

  describe("GetConfig", function () {
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
            command.input == "GymBookingAssistant"
          );
        }),
      );
      expect(actualAppId).to.equal(appId);
      expect(actualClientId).to.equal(clientId);
    });
  });

  describe("GetUserCredentials", function () {
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
  });

  it("Should invoke AWS Secrets manager ever time", async function () {
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
