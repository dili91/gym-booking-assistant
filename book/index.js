const BOOKING_API_BASE_URI = "https://api-exerp.mywellness.com";

exports.handler = async (event) => {
  //I need to discriminate between booking that require station and those and don't
  console.log(event);

  //TODO: login

  //TODO: get class detail. Need to poll till BookingInfo.bookingUserStatus is CanBook

  //TODO: book

  //TODO: send out event with outcome
};
