import playwright from "playwright-chromium";
import dotenv from "dotenv";
import invariant from "tiny-invariant";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import codec from "string-codec"
import FormData from "form-data";
import axios from "axios";

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();

// make sure all env variables are set
invariant(process.env.GEO_LATITUDE, "secret GEO_LATITUDE is required");
invariant(process.env.GEO_LONGITUDE, "secret GEO_LONGITUDE is required");
invariant(process.env.ACCOUNT_EMAIL, "secret ACCOUNT_EMAIL is required");
invariant(process.env.ACCOUNT_PASSWORD, "secret ACCOUNT_PASSWORD is required");

const PUBLIC_HOLIDAYS = [
  "01 Jan 2024",
  "08 Feb 2024",
  "09 Feb 2024",
  "10 Feb 2024",
  "11 Mar 2024",
  "12 Mar 2024",
  "29 Mar 2024",
  "31 Mar 2024",
  "08 Apr 2024",
  "09 Apr 2024",
  "10 Apr 2024",
  "11 Apr 2024",
  "12 Apr 2024",
  "15 Apr 2024",
  "01 May 2024",
  "09 May 2024",
  "10 May 2024",
  "23 May 2024",
  "24 May 2024",
  "01 Jun 2024",
  "17 Jun 2024",
  "18 Jun 2024",
  "07 Jul 2024",
  "17 Aug 2024",
  "16 Sept 2024",
  "25 Dec 2024",
  "26 Dec 2024"
];

const main = async () => {
  const isHeadless =
    (process.env.HEADLESS_BROWSER ?? "true") === "true" ? true : false;

  const TODAY = dayjs().tz("Asia/Jakarta").format("DD MMM YYYY");
  const TODAY_TALENTA = dayjs().tz("Asia/Jakarta").format("ddd, D MMM YYYY");

  if (PUBLIC_HOLIDAYS.includes(TODAY)) {
    console.log("Today is public holiday, skipping check in/out...");
    return;
  }

  const browser = await playwright["chromium"].launch({
    headless: isHeadless,
  });

  const context = await browser.newContext({
    viewport: { width: 1080, height: 560 },
    geolocation: {
      latitude: Number(process.env.GEO_LATITUDE),
      longitude: Number(process.env.GEO_LONGITUDE),
    },
    permissions: ["geolocation"],
  });

  const page = await context.newPage();

  console.log("Opening login page...");
  await page.goto(
    "https://account.mekari.com/users/sign_in?client_id=TAL-73645&return_to=L2F1dGg_Y2xpZW50X2lkPVRBTC03MzY0NSZyZXNwb25zZV90eXBlPWNvZGUmc2NvcGU9c3NvOnByb2ZpbGU%3D"
  );

  await page.setViewportSize({ width: 1080, height: 560 });

  console.log("Filling in account email & password...");
  await page.click("#user_email");
  await page.type("#user_email", process.env.ACCOUNT_EMAIL);

  await page.press("#user_email", "Tab");
  await page.type("#user_password", process.env.ACCOUNT_PASSWORD);

  console.log("Signing in...");
  await Promise.all([
    page.click("#new-signin-button"),
    page.waitForNavigation(),
  ]);

  const dashboardNav = page.getByText("Dashboard");
  // check if dashboard nav is exist
  if ((await dashboardNav.innerText()) === "Dashboard") {
    console.log("Successfully Logged in...");
  }

  const myName = (await page.locator("#navbar-name").textContent()).trim();
  const whoIsOffToday = await page
    .locator(".tl-card-small", { hasText: `Who's Off` })
    .innerText();

  const isOffToday = whoIsOffToday.includes(myName);

  if (isOffToday) {
    console.log("You are off today, skipping check in/out...");
    await browser.close();
    return;
  }

  // go to "My Attendance Logs"
  await page.click("text=My Attendance Logs");
  await page.waitForSelector(`h3:text("Present")`);
  console.log(
    "Already inside My Attendance Logs to check holiday or day-off..."
  );

  let rowToday = page.locator("tr", { hasText: TODAY_TALENTA }).first();
  console.log(
    "Check Row Today"
  );
  //Check if rowToday exists
  if (!await rowToday.isVisible()) {
    const nextMonth = dayjs(TODAY).add(1, "month").format("MMM YYYY");
    console.log("Row Today not found, Change month ", nextMonth);
    await page.click("#datepicker-attendance-detail-input");
    await page.fill("#datepicker-attendance-detail-input", '');
    await page.fill("#datepicker-attendance-detail-input", nextMonth);
    rowToday = page.locator("tr", { hasText: TODAY_TALENTA }).first();

  }
  const columnCheckDayOff = await rowToday
    .locator("td:nth-child(2)")
    .innerText();

  console.log(
    "Check column 2", columnCheckDayOff
  );

  const columnCheckOnLeave = await rowToday
    .locator("td:nth-child(7)")
    .innerText();

  console.log(
    "Check column 7", columnCheckOnLeave
  );

  const columnCheckCheckInTime = await rowToday
    .locator("td:nth-child(5)")
    .innerText();

  console.log(
    "Check column 5", columnCheckCheckInTime
  );

  const columnCheckCheckOutTime = await rowToday
    .locator("td:nth-child(6)")
    .innerText();

  console.log(
    "Check column 6", columnCheckCheckOutTime
  );

  // // N = not dayoff/holiday
  const isTodayHoliday = columnCheckDayOff.trim() !== "N";

  // // CT = cuti
  const isTodayOnLeave = columnCheckOnLeave.trim() === "CT";
  const isTodayOnLeaveNew = columnCheckOnLeave.trim() === "CTA";
  console.log(isTodayOnLeaveNew)
  console.log(columnCheckOnLeave.trim())

  // // - = not checkin yet
  const isAlreadyCheckin = columnCheckCheckInTime.trim() !== "-";

  // // - = not checkout yet
  const isAlreadyCheckout = columnCheckCheckOutTime.trim() !== "-";

  const shouldSkipCheckInOut = isTodayHoliday || isTodayOnLeave || isTodayOnLeaveNew;

  if (shouldSkipCheckInOut) {
    const consoleText = (isTodayOnLeave || isTodayOnLeaveNew)
      ? "You are on leave (cuti) today, skipping check in/out..."
      : "You are on holiday today, skipping check in/out...";
    console.log(consoleText);

    await browser.close();
    return;
  }

  if (isAlreadyCheckin && process.env.CHECK_TYPE === "CHECK_IN") {
    const consoleText = "You are already Check In, skipping check in...";
    console.log(consoleText);

    await browser.close();
    return;
  }

  if (isAlreadyCheckout && process.env.CHECK_TYPE === "CHECK_OUT") {
    const consoleText = "You are already Check Out, skipping check out...";
    console.log(consoleText);

    await browser.close();
    return;
  }

  if (process.env.SKIP_CHECK_IN_OUT === "true") {
    console.log("Skipping Check In/Out...");
    await browser.close();
    return;
  }

  const cookies = await context.cookies()

  let obj = cookies.find(o => o.name === 'PHPSESSID');

  if (obj === undefined) {
    console.log("Can't find PHPSESSID Cookies");
    await browser.close();
    return;
  }

  let desc = "Check In";
  if (process.env.CHECK_TYPE === "CHECK_OUT") {
    desc = "Check Out";
  }

  const config = prepForm({
    long: process.env.GEO_LONGITUDE,
    lat: process.env.GEO_LATITUDE,
    desc: desc,
    cookies: "PHPSESSID=" + obj.value,
    isCheckOut: process.env.CHECK_TYPE === "CHECK_IN" ? false : true
  });

  const data = await attendancePost(config)

  console.log("Success " + process.env.CHECK_TYPE)

  await browser.close();
};

const prepForm = (obj) => {
  const { long, lat, desc, cookies, isCheckOut = false } = obj;
  const data = new FormData();
  const status = isCheckOut ? "checkout" : "checkin";

  const longEncoded = codec.encoder(codec.encoder(long, "base64"), "rot13");
  const latEncoded = codec.encoder(codec.encoder(lat, "base64"), "rot13");

  data.append("longitude", longEncoded);
  data.append("latitude", latEncoded);
  data.append("status", status);
  data.append("description", desc);

  const config = {
    method: "post",
    url: "https://hr.talenta.co/api/web/live-attendance/request",
    headers: {
      Cookie: cookies,
      ...data.getHeaders(),
    },
    data: data,
  };

  return config;
};

const attendancePost = async (config) => {
  const resp = await axios(config);

  return resp.data;
};

main();
