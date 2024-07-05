const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

var scan = require("../index");
var utils = require("/opt/nodejs/utils");
var gymApiClient = require("/opt/nodejs/gymApiClient");

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
  let loginStub;
  let genericHttpClientStub;

  beforeEach(() => {
    // Stub interactions with secrets
    getSecretStub = sandbox.stub(utils, "getSecret");
    stubSecretConfig();

    // Stub HTTP client
    let httpClientFake = gymApiClient.getHttpClient();
    httpClientFake.interceptors.request.handlers = [];

    loginStub = sandbox.stub(gymApiClient, "login");
    loginStub.returns({
      token: "a-mock-token",
    });

    genericHttpClientStub = sandbox.stub(httpClientFake, "request");
    genericHttpClientStub
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
    utilsStub = sandbox
      .stub(gymApiClient, "getHttpClient")
      .returns(httpClientFake);

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
    genericHttpClientStub
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
            cannotTrack: false,
            name: "Cycle Race",
            room: "Studio Cycle",
            roomId: "610407c8f03bcd23e39aa1f9",
            hasLayout: true,
            startDate: "2024-07-07T10:30:00",
            partitionDate: 20240707,
            endDate: "2024-07-07T11:30:00",
            recurrenceStartDate: "2024-07-07T10:30:00",
            recurrenceEndDate: "2024-07-07T11:30:00",
            isSingleOccurrence: true,
            calendarEventType: "Class",
            eventTypeId: "7f90a46f-517c-4b7c-aecb-37e3d570c7da",
            staffId: "3689dcae-9fda-4d0f-80ac-4c52eaab9aba",
            staffUserId: "228a56ed-53ab-48dd-bdf9-6af74fb785fa",
            assignedTo: "Rossi Mario",
            facilityName: "Milano Bocconi",
            facilityId: "b65351c6-02b4-4e62-9d8c-416e17b9b6fe",
            chainId: "34ba747a-29f2-46bf-b82a-ecefb4db4951",
            pictureUrl:
              "https://publicmedia.mywellness.com/physical_activities/images/7ca2347e-aaf7-40c0-82b4-ccf7cf841343.jpg",
            maxParticipants: 15,
            isParticipant: false,
            hasBeenDone: false,
            metsPerHour: 5,
            estimatedCalories: 438,
            estimatedMove: 833,
            autoLogin: false,
            tags: [],
            waitingListPosition: 0,
            waitingListCounter: 0,
            isInWaitingList: false,
            liveEvent: false,
            autoStartEvent: false,
            availablePlaces: 4,
            extData: {},
            bookingInfo: {
              bookingOpensOn: "2024-07-02T10:30:00+02:00",
              bookingOpensOnMinutesInAdvance: 7200,
              priorityBookingMinutesInAdvance: 7200,
              cancellationMinutesInAdvance: 120,
              bookingHasWaitingList: true,
              bookingTimeInAdvanceType: "Hours",
              bookingTimeInAdvanceValue: 120,
              bookingUserStatus: "CanBook",
              bookingAvailable: true,
              dayInAdvanceStartHour: 0,
              dayInAdvanceStartMinutes: 0,
            },
            skus: [],
            actualizedStartDateTime: "2024-07-07T10:30:00",
            hasPenaltiesOn: false,
            numberOfParticipants: 11,
            bookOpenedNotificationReminderEnabled: false,
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
    sandbox.assert.calledThrice(getSecretStub);
    sandbox.assert.calledOnce(genericHttpClientStub);
    sandbox.assert.calledOnce(loginStub);
    sandbox.assert.calledOnceWithMatch(
      genericHttpClientStub,
      sandbox.match(function (request) {
        return request.method == "GET" && request.url.endsWith("/class/search");
      }),
    );

    sandbox.assert.calledOnceWithMatch(
      eventBridgeStub,
      sandbox.match(function (command) {
        const e = command.input.Entries[0];
        const eventPayload = JSON.parse(e.Detail);
        return (
          command instanceof PutEventsCommand &&
          e.Source == "GymBookingAssistant.scan" &&
          e.DetailType == "ClassBookingAvailable" &&
          eventPayload.id == classId &&
          eventPayload.bookingInfo.bookingUserStatus == "CanBook"
        );
      }),
    );
  });

  it("It should find a class that cannot be booked immediately, and schedule a dynamic rule on EventBridge to book it as soon as possible", async function () {
    // Arrange
    const classId = uuidv4();
    genericHttpClientStub
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
            cannotTrack: false,
            name: "Cycle Race",
            room: "Studio Cycle",
            roomId: "610407c8f03bcd23e39aa1f9",
            hasLayout: true,
            startDate: "2024-07-03T07:15:00",
            partitionDate: 20240703,
            endDate: "2024-07-03T08:15:00",
            recurrenceStartDate: "2024-05-02T07:15:00",
            recurrenceEndDate: "2025-03-31T08:15:00",
            isSingleOccurrence: false,
            calendarEventType: "Class",
            eventTypeId: "7f90a46f-517c-4b7c-aecb-37e3d570c7da",
            staffId: "569d7004-10d0-4722-9578-30eeb2bb344b",
            staffUserId: "881d683e-181b-4094-934f-74c3266d1197",
            assignedTo: "De Bernardi Simona",
            facilityName: "Milano Bocconi",
            facilityId: "b65351c6-02b4-4e62-9d8c-416e17b9b6fe",
            chainId: "34ba747a-29f2-46bf-b82a-ecefb4db4951",
            pictureUrl:
              "https://publicmedia.mywellness.com/physical_activities/images/7ca2347e-aaf7-40c0-82b4-ccf7cf841343.jpg",
            maxParticipants: 15,
            isParticipant: false,
            hasBeenDone: false,
            metsPerHour: 5,
            estimatedCalories: 438,
            estimatedMove: 833,
            autoLogin: false,
            tags: [],
            waitingListPosition: 0,
            waitingListCounter: 0,
            isInWaitingList: false,
            liveEvent: false,
            autoStartEvent: false,
            availablePlaces: 0,
            extData: {},
            bookingInfo: {
              bookingOpensOn: "2024-06-28T07:15:00+02:00",
              bookingOpensOnMinutesInAdvance: 7200,
              priorityBookingMinutesInAdvance: 7200,
              cancellationMinutesInAdvance: 120,
              bookingHasWaitingList: true,
              bookingTimeInAdvanceType: "Hours",
              bookingTimeInAdvanceValue: 48,
              bookingUserStatus: "WaitingBookingOpensPremium",
              bookingAvailable: true,
              dayInAdvanceStartHour: 0,
              dayInAdvanceStartMinutes: 0,
            },
            skus: [],
            actualizedStartDateTime: "2024-07-03T07:15:00",
            hasPenaltiesOn: false,
            numberOfParticipants: 13,
            bookOpenedNotificationReminderEnabled: false,
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
    sandbox.assert.calledOnce(genericHttpClientStub);
    sandbox.assert.calledOnce(loginStub);
    sandbox.assert.neverCalledWith(
      eventBridgeStub,
      sandbox.match(sandbox.match.instanceOf(PutEventsCommand)),
    );

    sandbox.assert.calledOnceWithMatch(
      schedulerStub,
      sandbox.match(function (command) {
        const c = command.input;
        const payload = JSON.parse(c.Target.Input);
        return (
          command instanceof CreateScheduleCommand &&
          c.Name == `ScheduleBooking_${classId}` &&
          c.Target.Arn.startsWith("arn:aws:lambda") &&
          c.Target.RoleArn.startsWith("arn:aws:iam") &&
          payload.id == classId &&
          payload.bookingInfo.bookingUserStatus == "WaitingBookingOpensPremium"
        );
      }),
    );
  });

  function stubSecretConfig() {
    getSecretStub.withArgs("loginUsername").returns("jdoe@example.com");
    getSecretStub.returns(uuidv4());
  }
});
