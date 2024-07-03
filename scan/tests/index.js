//TODO: review Secret manager and API mocks!

const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

var scan = require("../index");
var utils = require("/opt/nodejs/utils");

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const {
  SchedulerClient,
  CreateScheduleCommand,
} = require("@aws-sdk/client-scheduler");

describe("Scan classes", function () {
  let getSecretStub;
  let eventBridgeStub;
  let schedulerStub;
  let restApiStub;

  beforeEach(() => {
    // Stub interactions with secrets
    getSecretStub = sandbox.stub(utils, "getSecret");
    stubSecretConfig();

    // Stub HTTP client
    let httpClientFake = utils.getHttpClient();
    httpClientFake.interceptors.request.handlers = [];
    restApiStub = sandbox.stub(httpClientFake, "request");
    restApiStub
      .withArgs(
        sandbox.match(function (request) {
          return request.method == "POST" && request.url.endsWith("/Login");
        }),
      )
      .returns({
        status: 200,
        data: {
          token: "a-mock-token",
        },
      });

    // Stub utils
    utilsStub = sandbox.stub(utils, "getHttpClient").returns(httpClientFake);

    // Stub for the interactions with AWS EventBridge
    eventBridgeStub = sandbox.stub(EventBridgeClient.prototype, "send");

    // Stub for the interactions with AWS EventBridge Scheduler
    schedulerStub = sandbox.stub(SchedulerClient.prototype, "send");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("It should find a class that can be booked immediately, and publish a ClassBookingAvailable event", async function () {
    // Arrange
    const classId = uuidv4();
    restApiStub
      .withArgs(
        sandbox.match(function (request) {
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
            startDate: "2024-07-03T18:45:00",
            endDate: "2024-07-03T19:45:00",
            hasLayout: true,
            bookingInfo: {
              bookingUserStatus: "CanBook",
            },
          },
        ],
      });

    eventBridgeStub
      .withArgs(
        sandbox.match.instanceOf(PutEventsCommand).and(
          sandbox.match(function (value) {
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
    sandbox.assert.callCount(getSecretStub, 5);

    sandbox.assert.calledTwice(restApiStub);
    sandbox.assert.calledWithMatch(
      restApiStub,
      sandbox.match(function (request) {
        return request.method == "POST" && request.url.endsWith("/Login");
      }),
    );
    sandbox.assert.calledWithMatch(
      restApiStub,
      sandbox.match(function (request) {
        return request.method == "GET" && request.url.endsWith("/class/search");
      }),
    );

    sandbox.assert.calledOnceWithMatch(
      eventBridgeStub,
      sandbox.match(function (command) {
        const e = command.input.Entries[0];
        return (
          command instanceof PutEventsCommand &&
          e.Source == "GymBookingAssistant.scan" &&
          e.DetailType == "ClassBookingAvailable" &&
          JSON.parse(e.Detail).class.id == classId
        );
      }),
    );
  });

  it("It should find a class that cannot be booked immediately, and schedule a dynamic rule on EventBridge to book it as soon as possible", async function () {
    // Arrange
    const classId = uuidv4();
    restApiStub
      .withArgs(
        sandbox.match(function (request) {
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
            startDate: "2024-07-03T18:45:00",
            endDate: "2024-07-03T19:45:00",
            hasLayout: true,
            bookingInfo: {
              bookingUserStatus: "WaitingBookingOpensPremium",
              bookingOpensOn: "2024-07-04T06:45:00+02:00",
            },
          },
        ],
      });

    schedulerStub
      .withArgs(
        sandbox.match.instanceOf(CreateScheduleCommand).and(
          sandbox.match(function (value) {
            return value.input.Name == `ScheduleBooking_${classId}`;
          }),
        ),
      )
      .returns({
        $metadata: {
          httpStatusCode: 200,
        },
      });

    // Act
    await scan.handler();

    // Assert
    sandbox.assert.neverCalledWith(
      eventBridgeStub,
      sandbox.match(sandbox.match.instanceOf(PutEventsCommand)),
    );

    sandbox.assert.calledOnceWithMatch(
      schedulerStub,
      sandbox.match(function (command) {
        const c = command.input;
        return (
          command instanceof CreateScheduleCommand &&
          c.Name == `ScheduleBooking_${classId}`
        );
      }),
    );
  });

  function stubSecretConfig() {
    getSecretStub.withArgs("loginUsername").returns("jdoe@example.com");
    getSecretStub.returns(uuidv4());
  }
});
