var sinon = require("sinon");
const axios = require("axios");

var scan = require("../index");

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

describe("Scan classes", function () {
  let secretsManagerStub;
  let gymApiMock;

  beforeEach(() => {
    // Stub secret manager 
    secretsManagerStub = sinon.stub(
      SecretsManagerClient.prototype,
      "send",
    );

    secretsManagerStub
      .withArgs(
        sinon.match
          .instanceOf(GetSecretValueCommand)
          // TODO: Can this be simplified?
          .and(
            sinon.match(function (value) {
              return value.input.SecretId == "GymBookingAssistant";
            }),
          ),
      )
      .returns({
        SecretString: JSON.stringify({
          applicationId: process.env["APPLICATION_ID"],
          facilityId: process.env["FACILITY_ID"],
          clientId: process.env["CLIENT_ID"],
          // TODO: structure this a bit more
          loginUsername: process.env["LOGIN_USERNAME"],
          loginPassword: process.env["LOGIN_PASSWORD"],
          loginDomain: process.env["LOGIN_DOMAIN"],
        }),
      });

      // Stub 
      gymApiMock = sinon.stub(axios, "request");

      // Stub login
      gymApiMock.withArgs(
        sinon.match(function(request){
          return request.method == 'POST' && request.url.endsWith('/Login')
        }))
        .returns({
          status: 200,
          data: {
            token: "a-mock-token"
          }
      })

      gymApiMock.withArgs(
        sinon.match(function(request){
          return request.method == 'GET' && request.url.endsWith('/class/search')
        }))
        .returns({
          status: 200,
          data: [
            {
              id: 12345678,
              name: 'Cycle burn',
              isParticipant: false,
              bookingInfo:{
                bookingUserStatus: 'CanBook'
              }
            }
          ]
      })
      
  });

  afterEach(() => {
    secretsManagerStub.restore();
    gymApiMock.restore();
  });

  it("It should find a class and publish a class available event", async function () {
    // TODO: arrange

    // Act
    await scan.handler();

    // Assert
    sinon.assert.calledOnce(secretsManagerStub)
  });
});
