const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm"); // ES Modules import
const { expect } = require("chai");

describe("Utils", function () {
  afterEach(() => {
    sandbox.restore();
  });

  describe("GetConfig", function () {
    let parametersStoreStub;

    afterEach(() => {
      sandbox.restore();
    });

    it("Should yield a config value and avoid calling AWS ParametersStore on subsequent calls", async function () {
      // Arrange
      let utils = require("../utils");
      // Stub for the interactions with AWS Parameters Store
      parametersStoreStub = sandbox.stub(SSMClient.prototype, "send");
      const appId = uuidv4();
      const clientId = uuidv4();
      parametersStoreStub.returns({
        "Parameter":{
          "Type": "String",
          "Value": `{"applicationId":"${appId}", "clientId":"${clientId}"}`
        }
      })

      // Act
      let actualAppId = await utils.getConfig("applicationId");
      let actualClientId = await utils.getConfig("clientId");

      // Assert
      sandbox.assert.calledOnceWithMatch(
        parametersStoreStub,
        sandbox.match(function (command) {
          return (
            command instanceof GetParameterCommand 
            && command.input == 'GymBookingAssistant'
          );
        }),
      );
      expect(actualAppId).to.equal(appId);
      expect(actualClientId).to.equal(clientId);
    })
  })
})