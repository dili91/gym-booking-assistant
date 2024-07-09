const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

var book = require("../index");
var utils = require("/opt/nodejs/utils");
var gymApiClient = require("/opt/nodejs/gymApiClient");

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

describe("Book class", function () {
  let getSecretStub;
  let eventBridgeStub;
  let loginStub;
  let genericHttpClientStub;

  beforeEach(() => {
    // Stub interactions with secrets
    getSecretStub = sandbox.stub(utils, "getSecret");
    stubSecretConfig();

    // Stub Gym API client
    let httpClientFake = gymApiClient.getHttpClient();
    httpClientFake.interceptors.request.handlers = [];
    genericHttpClientStub = sandbox.stub(httpClientFake, "request");
    utilsStub = sandbox
      .stub(gymApiClient, "getHttpClient")
      .returns(httpClientFake);

    // Stub login response
    loginStub = sandbox.stub(gymApiClient, "login");
    loginStub.returns({
      token: "a-mock-token",
    });

    // Stub for the interactions with AWS EventBridge
    eventBridgeStub = sandbox.stub(EventBridgeClient.prototype, "send");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("It should book a class and publish a ClassBookingCompleted event with a booked=true flag", async function () {
    // Arrange
    const classBookingAvailableEvent = createTestClassBookingAvailableEvent();
    genericHttpClientStub
      .withArgs(
        sandbox.match(function (request) {
          return (
            request.method == "POST" &&
            request.url.endsWith(
              `/core/calendarevent/${classBookingAvailableEvent.detail.id}/book`,
            ) &&
            request.headers.Authorization.length > 0
          );
        }),
      )
      .returns({
        status: 200,
        data: {
          data: "Booked",
          token: uuidv4(),
          version: uuidv4(),
          expireIn: 31104000,
        },
      });

    eventBridgeStub
      .withArgs(
        sandbox.match.instanceOf(PutEventsCommand).and(
          sandbox.match(function (value) {
            const e = value.input.Entries[0];
            return (
              e.Source == "GymBookingAssistant.book" &&
              e.DetailType == "ClassBookingCompleted"
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
    await book.handler(classBookingAvailableEvent);

    // Assert
    sandbox.assert.calledThrice(getSecretStub);

    sandbox.assert.calledOnce(loginStub);
    sandbox.assert.calledOnceWithMatch(
      genericHttpClientStub,
      sandbox.match(function (request) {
        return (
          request.method == "POST" &&
          request.url.endsWith(
            `/core/calendarevent/${classBookingAvailableEvent.detail.id}/book`,
          ) &&
          request.headers.Authorization.length > 0 &&
          request.data.partitionDate ==
            classBookingAvailableEvent.detail.partitionDate
        );
      }),
    );

    sandbox.assert.calledOnceWithMatch(
      eventBridgeStub,
      sandbox.match(function (command) {
        const e = command.input.Entries[0];
        const eventPayload = JSON.parse(e.Detail);
        return (
          command instanceof PutEventsCommand &&
          e.Source == "GymBookingAssistant.book" &&
          e.DetailType == "ClassBookingCompleted" &&
          eventPayload.result.booked == true &&
          eventPayload.partitionDate ==
            classBookingAvailableEvent.detail.partitionDate &&
          eventPayload.classId == classBookingAvailableEvent.detail.id
        );
      }),
    );
  });

  it("It should reject booking a class if its status is different from CanBook", async function () {
    // Arrange
    const classBookingAvailableEvent = createTestClassBookingAvailableEvent(
      utils.nowCET().add(6, "hour"),
      120,
      "CannotBook",
    );

    // Act
    await book.handler(classBookingAvailableEvent);

    // Assert
    sandbox.assert.notCalled(getSecretStub);
    sandbox.assert.notCalled(loginStub);
    sandbox.assert.notCalled(genericHttpClientStub);
    sandbox.assert.notCalled(eventBridgeStub);
  });

  it("It should reject booking a class if there's not enough time to un-book it", async function () {
    // Arrange
    const classBookingAvailableEvent = createTestClassBookingAvailableEvent(
      utils.nowCET().add(1, "hour"),
      120,
    );

    // Act
    await book.handler(classBookingAvailableEvent);

    // Assert
    sandbox.assert.notCalled(getSecretStub);
    sandbox.assert.notCalled(loginStub);
    sandbox.assert.notCalled(genericHttpClientStub);
    sandbox.assert.notCalled(eventBridgeStub);
  });

  it("It should publish a ClassBookingCompleted event with a booked=false flag and an errors array if the class can't be booked", async function () {
    // Arrange
    const classBookingAvailableEvent = createTestClassBookingAvailableEvent();
    let tooEarlyBookingError = {
      field: "BookingApiException.TooEarlyToBookParticipantException",
      type: "Validation",
      details: "",
      errorMessage: "The class is not open for booking yet",
      message: "The class is not open for booking yet",
    };

    genericHttpClientStub
      .withArgs(
        sandbox.match(function (request) {
          return (
            request.method == "POST" &&
            request.url.endsWith(
              `/core/calendarevent/${classBookingAvailableEvent.detail.id}/book`,
            ) &&
            request.headers.Authorization.length > 0
          );
        }),
      )
      .returns({
        status: 200, //API returns 200 in this case as well...
        data: {
          errors: [tooEarlyBookingError],
        },
      });

    eventBridgeStub
      .withArgs(
        sandbox.match.instanceOf(PutEventsCommand).and(
          sandbox.match(function (value) {
            const e = value.input.Entries[0];
            return (
              e.Source == "GymBookingAssistant.book" &&
              e.DetailType == "ClassBookingCompleted"
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
    await book.handler(classBookingAvailableEvent);

    // Assert
    sandbox.assert.calledThrice(getSecretStub);

    sandbox.assert.calledOnce(loginStub);
    sandbox.assert.calledOnceWithMatch(
      genericHttpClientStub,
      sandbox.match(function (request) {
        return (
          request.method == "POST" &&
          request.url.endsWith(
            `/core/calendarevent/${classBookingAvailableEvent.detail.id}/book`,
          ) &&
          request.headers.Authorization.length > 0 &&
          request.data.partitionDate ==
            classBookingAvailableEvent.detail.partitionDate
        );
      }),
    );

    sandbox.assert.calledOnceWithMatch(
      eventBridgeStub,
      sandbox.match(function (command) {
        const e = command.input.Entries[0];
        const eventPayload = JSON.parse(e.Detail);
        return (
          command instanceof PutEventsCommand &&
          e.Source == "GymBookingAssistant.book" &&
          e.DetailType == "ClassBookingCompleted" &&
          eventPayload.result.booked == false &&
          eventPayload.result.errors[0].field == tooEarlyBookingError.field &&
          eventPayload.partitionDate ==
            classBookingAvailableEvent.detail.partitionDate &&
          eventPayload.classId == classBookingAvailableEvent.detail.id
        );
      }),
    );
  });

  function stubSecretConfig() {
    getSecretStub.withArgs("loginUsername").returns("jdoe@example.com");
    getSecretStub.returns(uuidv4());
  }

  function createTestClassBookingAvailableEvent(
    startDateCET,
    cancellationMinutesInAdvance,
    bookingStatus,
  ) {
    if (!startDateCET) {
      startDateCET = utils.nowCET().add(6, "hour");
    }

    if (!cancellationMinutesInAdvance) {
      cancellationMinutesInAdvance = 120;
    }

    if (!bookingStatus) {
      bookingStatus = "CanBook";
    }

    return {
      id: uuidv4(), //event id
      "detail-type": "ClassBookingAvailable",
      source: "GymBookingAssistant.scan",
      detail: {
        id: uuidv4(),
        partitionDate: startDateCET.format("YYYYMMDD"),
        startDate: startDateCET.format("YYYY-MM-DDTHH:mm:ss"),
        bookingInfo: {
          cancellationMinutesInAdvance: cancellationMinutesInAdvance,
          bookingUserStatus: bookingStatus,
        },
      },
    };
  }
});
