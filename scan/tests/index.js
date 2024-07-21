const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");
var itParam = require("mocha-param");

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
  let getUserCredentialsStub;
  let getConfigStub;
  let eventBridgeStub;
  let schedulerStub;
  let loginStub;
  let genericHttpClientStub;

  beforeEach(() => {
    // Stub interactions with secrets
    getUserCredentialsStub = sandbox.stub(utils, "getUserCredentials");
    getConfigStub = sandbox.stub(utils, "getConfig");
    stubSecretsAndConfig();

    nowCETStub = sandbox.stub(utils, "nowCET");

    // Stub Gym API client
    let httpClientFake = gymApiClient.getHttpClient();
    httpClientFake.interceptors.request.handlers = [];
    genericHttpClientStub = sandbox.stub(httpClientFake, "request");
    gymApiClientStub = sandbox
      .stub(gymApiClient, "getHttpClient")
      .returns(httpClientFake);

    // Stub login response
    loginStub = sandbox.stub(gymApiClient, "login");
    loginStub.returns({
      token: "a-mock-token",
    });

    // Stub for the interactions with AWS EventBridge
    eventBridgeStub = sandbox.stub(EventBridgeClient.prototype, "send");

    // Stub for the interactions with AWS EventBridge Scheduler
    schedulerStub = sandbox.stub(SchedulerClient.prototype, "send");
  });

  afterEach(() => {
    sandbox.restore();
  });

  itParam(
    "It should book a class starting at ${value.classStartDate} as matching configured search criteria",
    [
      //nowCET makes the test stable over time
      {
        nowCET: "2024-07-11T08:00:00",
        classStartDate: "2024-07-11T09:00:00", // match morning range (Thursday, same day of now)
      },
      {
        nowCET: "2024-07-11T08:00:00",
        classStartDate: "2024-07-15T09:00:00", // match morning range (Monday)
      },
      {
        nowCET: "2024-07-11T10:00:00",
        classStartDate: "2024-07-12T18:15:00", // match evening range (Friday)
      },
      {
        nowCET: "2024-07-11T10:00:00",
        classStartDate: "2024-07-12T18:00:01", // match evening range (Friday). Note that the isBetween function is non inclusive!
      },
    ],
    async function (value) {
      // Arrange
      const classId = uuidv4();
      const nowCET = utils.stringToDateCET(value.nowCET);
      const startDateCET = utils.stringToDateCET(value.classStartDate);

      nowCETStub.returns(nowCET);
      stubSearchClassResponse(classId, "Pilates", "CanBook", startDateCET);
      eventBridgeStub.returns({
        $metadata: {
          httpStatusCode: 200,
        },
      });

      // Act
      await scan.handler();

      // Assert
      sandbox.assert.calledThrice(getUserCredentialsStub);
      sandbox.assert.calledOnce(loginStub);
      sandbox.assert.calledOnceWithMatch(
        genericHttpClientStub,
        sandbox.match(function (request) {
          return (
            request.method == "GET" &&
            request.url.endsWith("/class/search") &&
            request.headers.Authorization.length > 0 &&
            request.params.fromDate == nowCET.format("yyyyMMDD")
          );
        }),
      );
      sandbox.assert.calledOnce(eventBridgeStub);
    },
  );

  itParam(
    "It should not book a class starting at ${value.classStartDate} because not matching configured search criteria",
    [
      //nowCET makes the test stable over time
      {
        nowCET: "2024-07-11T08:00:00",
        classStartDate: "2024-07-14T09:00:00", // Does not match because happening during the weekend
      },
      {
        nowCET: "2024-07-11T08:00:00",
        classStartDate: "2024-07-15T07:00:00", // Too early
      },
      {
        nowCET: "2024-07-11T10:00:00",
        classStartDate: "2024-07-12T15:15:00", // During core working hours early
      },
      {
        nowCET: "2024-07-11T10:00:00",
        classStartDate: "2024-07-12T21:15:00", // Too late
      },
      {
        nowCET: "2024-07-11T08:00:00",
        classStartDate: "2024-07-11T08:00:00", // Too early: the isBetween function is non inclusive!
      },
    ],
    async function (value) {
      // Arrange
      const classId = uuidv4();
      const nowCET = utils.stringToDateCET(value.nowCET);
      const startDateCET = utils.stringToDateCET(value.classStartDate);
      nowCETStub.returns(nowCET);

      stubSearchClassResponse(classId, "Pilates", "CanBook", startDateCET);
      eventBridgeStub.returns({
        $metadata: {
          httpStatusCode: 200,
        },
      });

      // Act
      await scan.handler();

      // Assert
      sandbox.assert.calledThrice(getUserCredentialsStub);
      sandbox.assert.calledOnce(loginStub);
      sandbox.assert.calledOnceWithMatch(
        genericHttpClientStub,
        sandbox.match(function (request) {
          return (
            request.method == "GET" &&
            request.url.endsWith("/class/search") &&
            request.headers.Authorization.length > 0 &&
            request.params.fromDate == nowCET.format("yyyyMMDD")
          );
        }),
      );
      sandbox.assert.notCalled(eventBridgeStub);
    },
  );

  it("It should publish ClassBookingAvailable event for an immediate booking", async function () {
    // Arrange
    const classId = uuidv4();

    // nowCET will return 2024-07-11T09:00:00, and so the test utils will build a class startDate 1 hour after
    nowCETStub.returns(utils.stringToDateCET("2024-07-11T09:00:00"));
    stubSearchClassResponse(classId, "Pilates", "CanBook");

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
    sandbox.assert.calledThrice(getUserCredentialsStub);
    sandbox.assert.calledOnce(loginStub);
    sandbox.assert.calledOnceWithMatch(
      genericHttpClientStub,
      sandbox.match(function (request) {
        return (
          request.method == "GET" &&
          request.url.endsWith("/class/search") &&
          request.headers.Authorization.length > 0
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
          e.Source == "GymBookingAssistant.scan" &&
          e.DetailType == "ClassBookingAvailable" &&
          eventPayload.id == classId &&
          eventPayload.bookingInfo.bookingUserStatus == "CanBook"
        );
      }),
    );
  });

  it("It should schedule a dynamic rule on EventBridge to book a class as soon as possible", async function () {
    // Arrange
    const classId = uuidv4();

    nowCETStub.returns(utils.stringToDateCET("2024-07-11T08:00:00"));
    stubSearchClassResponse(classId, "Pilates", "WaitingBookingOpensPremium");

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
          c.Target.EventBridgeParameters.Source == "GymBookingAssistant.scan" &&
          c.Target.EventBridgeParameters.DetailType ==
            "ClassBookingAvailable" &&
          payload.id == classId &&
          payload.bookingInfo.bookingUserStatus == "WaitingBookingOpensPremium"
        );
      }),
    );
  });

  function stubSecretsAndConfig() {
    getUserCredentialsStub.returns({
      loginUsername: "jdoe@example.com",
      loginPassword: uuidv4(),
      userId: uuidv4(),
    });
    getConfigStub.returns(uuidv4());
  }

  /**
   * Helper to schedule search classes responses from the Gym API
   * @param {*} id id of the class
   * @param {*} name name of the class
   * @param {*} status booking status of the class. One of CanBook, WaitingBookingOpensPremium, CannotBook, others...
   * @param {*} startDate the startDate of the class in CET format. must be a Moment date
   */
  function stubSearchClassResponse(id, name, status, startDate) {
    // Parse the date in the specified timezone
    const dateFormat = "YYYY-MM-DDTHH:mm:ss";

    if (!startDate) {
      startDate = utils.nowCET().add(1, "hour");
    }

    const startDateStringCET = startDate.format(dateFormat);
    const endDateStringCET = startDate
      .clone()
      .add(1, "hour")
      .format(dateFormat);

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
            id: id,
            cannotTrack: false,
            name: name,
            room: "Studio Cycle",
            roomId: "610407c8f03bcd23e39aa1f9",
            hasLayout: true,
            startDate: startDateStringCET,
            partitionDate: 20240703,
            endDate: endDateStringCET,
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
              bookingUserStatus: status,
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
  }
});
