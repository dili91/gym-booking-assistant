//TODO: review Secret manager and API mocks!

var sinon = require("sinon");
const { v4: uuidv4 } = require("uuid");

var scan = require("../index");
var utils = require("/opt/nodejs/utils");

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

describe("Scan classes", function () {
  let secretsManagerStub;
  let getSecretSpy;
  let eventBridgeStub;
  //let gymApiMock;

  beforeEach(() => {
    secretsManagerStub = sinon.stub(SecretsManagerClient.prototype, "send");

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

    getSecretSpy = sinon.spy(utils, "getSecret");

    eventBridgeStub = sinon.stub(EventBridgeClient.prototype, "send");

    //gymApiMock = sinon.stub(axios, "request");
  });

  afterEach(() => {
    secretsManagerStub.restore();
    getSecretSpy.restore();
    //gymApiMock.restore();
  });

  it("It should find a class that can be booked immediately, and publish a ClassBookingAvailable event", async function () {
    // Arrange
    const classId = uuidv4();

    // gymApiMock
    //   .withArgs(
    //     sinon.match(function (request) {
    //       return request.method == "POST" && request.url.endsWith("/Login");
    //     }),
    //   )
    //   .returns({
    //     status: 200,
    //     data: {
    //       token: "a-mock-token",
    //     },
    //   });

    // gymApiMock
    //   .withArgs(
    //     sinon.match(function (request) {
    //       return (
    //         request.method == "GET" && request.url.endsWith("/class/search")
    //       );
    //     }),
    //   )
    //   .returns({
    //     status: 200,
    //     data: [
    //       {
    //         id: classId,
    //         name: "Cycle burn",
    //         isParticipant: false,
    //         bookingInfo: {
    //           bookingUserStatus: "CanBook",
    //         },
    //       },
    //     ],
    //   });

    eventBridgeStub
      .withArgs(
        sinon.match.instanceOf(PutEventsCommand).and(
          sinon.match(function (value) {
            const e = value.input.Entries[0];
            return (
              e.Source == "GymBookingAssistant.scan" &&
              e.DetailType == "ClassBookingAvailable"
            );
          }),
        ),
      )
      .returns({
        $metadata: {
          httpStatusCode: 200,
        },
        Entries: [
          {
            EventId: "12345678",
          },
        ],
        FailedEntryCount: 0,
      });

    // Act
    await scan.handler();

    // Assert
    sinon.assert.callCount(getSecretSpy, 5);
    // sinon.assert.calledTwice(gymApiMock);
    // sinon.assert.calledWithMatch(
    //   gymApiMock,
    //   sinon.match(function (request) {
    //     return request.method == "POST" && request.url.endsWith("/Login");
    //   }),
    // );
    // sinon.assert.calledWithMatch(
    //   gymApiMock,
    //   sinon.match(function (request) {
    //     return request.method == "GET" && request.url.endsWith("/class/search");
    //   }),
    // );
    sinon.assert.calledOnceWithMatch(
      eventBridgeStub,
      sinon.match(function (command) {
        const e = command.input.Entries[0];
        return (
          e.Source == "GymBookingAssistant.scan" &&
          e.DetailType == "ClassBookingAvailable" &&
          JSON.parse(e.Detail).class.id == classId
        );
      }),
    );
  });
});
