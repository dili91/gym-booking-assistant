//TODO: review Secret manager and API mocks!

var sinon = require("sinon");
const { v4: uuidv4 } = require("uuid");

var scan = require("../index");
var utils = require("/opt/nodejs/utils");

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

describe("Scan classes", function () {
  let getSecretStub;
  let eventBridgeStub;
  let restApiStub;

  //TODO move
  let classId = uuidv4();

  beforeEach(() => {
    // Stub interactions with secrets
    getSecretStub = sinon.stub(utils, "getSecret");
    stubSecretConfig();

    // Stub HTTP client
    let httpClientFake = utils.getHttpClient();
    httpClientFake.interceptors.request.handlers = [];
    restApiStub = sinon.stub(httpClientFake, "request");
    sinon.stub(utils, "getHttpClient").returns(httpClientFake);

    // Stub for the interactions with AWS EventBridge
    eventBridgeStub = sinon.stub(EventBridgeClient.prototype, "send");
  });

  afterEach(() => {
    getSecretStub.restore();
    eventBridgeStub.restore();
    restApiStub.restore();
  });

  it("It should find a class that can be booked immediately, and publish a ClassBookingAvailable event", async function () {
    // Arrange
    restApiStub
      .withArgs(
        sinon.match(function (request) {
          return request.method == "POST" && request.url.endsWith("/Login");
        }),
      )
      .returns({
        status: 200,
        data: {
          token: "a-mock-token",
        },
      });

    restApiStub
      .withArgs(
        sinon.match(function (request) {
          return (
            request.method == "GET" && request.url.endsWith("/class/search")
          );
        }),
      )
      .returns({
        status: 200,
        data: [
          {
            id: classId,
            name: "Cycle burn",
            isParticipant: false,
            bookingInfo: {
              bookingUserStatus: "CanBook",
            },
          },
        ],
      });

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
    sinon.assert.callCount(getSecretStub, 5);

    sinon.assert.calledTwice(restApiStub);
    sinon.assert.calledWithMatch(
      restApiStub,
      sinon.match(function (request) {
        return request.method == "POST" && request.url.endsWith("/Login");
      }),
    );
    sinon.assert.calledWithMatch(
      restApiStub,
      sinon.match(function (request) {
        return request.method == "GET" && request.url.endsWith("/class/search");
      }),
    );

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

  function stubSecretConfig() {
    getSecretStub.withArgs("loginUsername").returns("jdoe@example.com");
    getSecretStub.returns(uuidv4());
  }
});
