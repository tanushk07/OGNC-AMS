const express = require("express");
const sql = require("mssql");
const router = express.Router();
const moment = require("moment-timezone");
const bcrypt = require("bcrypt");
const session = require("express-session");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const { VarChar } = require("msnodesqlv8");

// Create a connection to the database
const config = {
  user: "abc",
  password: "1234",
  server: "localhost\\MSSQLSERVER01",
  database: "HLS_DB",
  port: 1433,
  options: {
    trustedconnection: false, // The named instance
    trustServerCertificate: true, // True if using self-signed certificates (optional)
  },
};

const config2 = {
  user: "tanushk",
  password: "1234",
  server: "localhost\\MSSQLSERVER02", // Specify the server with the named instance
  database: "project",
  port: 1433,
  options: {
    trustedConnection: false, // Should be camelCase
    trustServerCertificate: true, // True if using self-signed certificates
  },
};

// router.get('/', async (req, res) => {
//   let pool;
//   try {
//     pool = await sql.connect(config);

//     pool.close()
//     // Render the view
// res.render('index', {
//   title: 'Dashboard',

// });

//   } catch (error) {
//     console.error('Error fetching summary data:', error);
//     res.status(500).send('Database Error');
//   } finally {
//     // Close the SQL connection
//     if (pool) await pool.close();
//   }
// });

router.get("/", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(config);

    // Query to get total number of employees
    const employeeCountResult = await pool.request().query(`
      SELECT COUNT(*) AS total_employees
      FROM [HLS_DB].[hls_schema_common].[tbl_employee_details]
    `);
    const totalEmployees = employeeCountResult.recordset[0].total_employees;

    // Query to get total number of sites
    const siteCountResult = await pool.request().query(`
      SELECT COUNT(DISTINCT site_id) AS total_sites
      FROM [HLS_DB].[hls_schema_common].tbl_site_details
    `);
    const totalSites = siteCountResult.recordset[0].total_sites;

    // Query to get today's total punches
    const punchesTodayResult = await pool.request().query(`
      SELECT COUNT(*) AS total_punches_today
      FROM  [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data]
      WHERE CAST(rec_timestamp AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const totalPunchesToday =
      punchesTodayResult.recordset[0].total_punches_today;

    // Query to get punches per site
    const punchesPerSiteResult = await pool.request().query(`
      SELECT dst.site_name, COUNT(*) AS punches_count
      FROM [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] ard
      JOIN [HLS_DB].[hls_schema_common].[tbl_employee_details] e ON ard.employee_id = e.employee_id
      JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id = dsd.ref_id
      JOIN [HLS_DB].[hls_schema_common].[tbl_site_details] dst ON dsd.site_id = dst.site_id
      WHERE CAST(ard.rec_timestamp AS DATE) = '2024-06-12'
      GROUP BY dst.site_name
      ORDER BY punches_count DESC
    `);
    // CAST(GETDATE() AS DATE)
    const punchesPerSite = punchesPerSiteResult.recordset;
    const siteThreshold = 500;
    // Close the SQL connection
    const employeeDistributionResult = await pool.request().query(`
      ;WITH SiteAggregated AS (
      SELECT dst.site_name, COUNT(*) AS employee_count
      FROM [HLS_DB].[hls_schema_common].[tbl_employee_details] e
      JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details]dsd ON e.department_site_ref_id = dsd.ref_id
      JOIN [HLS_DB].[hls_schema_common].[tbl_site_details]  dst ON dsd.site_id = dst.site_id
      GROUP BY dst.site_name
    ),
    SiteWithAggregates AS (
    SELECT
      site_name,
      employee_count,
      CASE 
        WHEN employee_count <= ${siteThreshold} THEN 'Others'
        ELSE site_name
      END AS site_group
    FROM
      SiteAggregated
  )
  SELECT
    site_group AS site_name,
    SUM(employee_count) AS employee_count
  FROM
    SiteWithAggregates
  GROUP BY
    site_group
    `);
    const employeeDistribution = employeeDistributionResult.recordset;

    const absenteesthismonthquery = await pool.request().query(`
      WITH WorkingDays AS (
    -- Generate all dates for the current month
    SELECT CAST(CONVERT(VARCHAR(7), GETDATE(), 120) + '-01' AS DATE) AS WorkDate
    UNION ALL
    SELECT DATEADD(DAY, 1, WorkDate)
    FROM WorkingDays
    WHERE DATEADD(DAY, 1, WorkDate) < DATEADD(MONTH, 1, CAST(CONVERT(VARCHAR(7), GETDATE(), 120) + '-01' AS DATE))
),
FilteredWorkingDays AS (
    -- Filter to include only Monday to Friday and exclude company holidays
    SELECT WorkDate
    FROM WorkingDays
    WHERE DATENAME(WEEKDAY, WorkDate) IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
),
PresentDays AS (
    -- Get the distinct days each employee punched in
    SELECT 
        p.employee_id AS Employee_ID,
        COUNT(DISTINCT CAST(p.rec_timestamp AS DATE)) AS PresentDays
    FROM 
        [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
    WHERE 
        CAST(p.rec_timestamp AS DATE) >= CAST(CONVERT(VARCHAR(7), GETDATE(), 120) + '-01' AS DATE)
        AND CAST(p.rec_timestamp AS DATE) < DATEADD(MONTH, 1, CAST(CONVERT(VARCHAR(7), GETDATE(), 120) + '-01' AS DATE))
    GROUP BY 
        p.employee_id
),
TotalWorkingDays AS (
    -- Get total working days count for the current month
    SELECT COUNT(WorkDate) AS TotalDays
    FROM FilteredWorkingDays
),
EmployeeAbsences AS (
    -- Calculate absentee days for each employee
    SELECT 
        e.employee_id AS Employee_ID,
        dsd.site_id AS Site_ID,
        ISNULL(twd.TotalDays, 0) AS TotalWorkingDays,
        ISNULL(pd.PresentDays, 0) AS PresentDays,
        CASE 
            WHEN ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0) < 0 THEN 0
            ELSE ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0)
        END AS AbsentDays
    FROM 
        [HLS_DB].[hls_schema_common].[tbl_employee_details] e
    JOIN
        [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id = dsd.ref_id
    CROSS JOIN 
        TotalWorkingDays twd
    LEFT JOIN 
        PresentDays pd ON e.employee_id = pd.Employee_ID
),
SiteAbsences AS (
    -- Aggregate absentee days by site
    SELECT 
        sd.site_name AS Site_Name,
        SUM(ea.AbsentDays) AS TotalAbsentDays
    FROM 
        EmployeeAbsences ea
    JOIN 
        hls_schema_common.tbl_site_details sd ON ea.Site_ID = sd.site_id
    GROUP BY 
        sd.site_name
)
SELECT * FROM SiteAbsences
OPTION (MAXRECURSION 0); -- Ensure that recursion limit is not an issue
`);
    const siteAbsences = absenteesthismonthquery.recordset;
    console.log(
      totalEmployees,
      totalPunchesToday,
      totalSites,
      punchesPerSite,
      employeeDistribution,
      siteAbsences
    );
    await pool.close();

    // Render the view with the fetched data
    res.render("index", {
      title: "Dashboard",
      totalEmployees,
      totalSites,
      totalPunchesToday,
      punchesPerSite,
      employeeDistribution,
      siteAbsences,
    });
  } catch (error) {
    console.error("Error fetching summary data:", error);
    res.status(500).send("Database Error");
  } finally {
    // Close the SQL connection if it's still open
    if (pool) await pool.close();
  }
});

router.post("/login", async (req, res) => {
  const { userid, password } = req.body;
  if (!userid || !password) {
    return res.status(400).send("Username and password are required");
  }
  let pool;
  try {
    // Connect to SQL Server
    pool = await sql.connect(config2);

    // Query to get user data based on the userid
    const query = `
     SELECT * FROM project.project.users WHERE userid = @userid
    `;

    // Execute the query
    const result = await pool
      .request()
      .input("userid", sql.VarChar, userid) // Adjust VarChar length if needed
      .query(query);

    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      await pool.close();
      try {
        // Compare passwords
        const match = await bcrypt.compare(password, user.Password);
        if (match) {
          req.session.user = { id: user.UserID, username: user.Username };
          req.session.save((err) => {
            if (err) {
              console.error("Error saving session:", err);
              return res.status(500).send("Error logging in");
            }
            res.redirect("/");
          });
        } else {
          res.status(401).send("Invalid username or password");
        }
      } catch (compareError) {
        console.error("Error comparing passwords:", compareError);
        res.status(500).send("Error logging in");
      }
    } else {
      res.status(401).send("Invalid username or password");
    }
  } catch (error) {
    console.error("Error querying database:", error);
    res.status(500).send("Error logging in");
  } finally {
    // Close the SQL connection
    if (pool) await pool.close();
  }
});

router.post("/signup", async (req, res) => {
  const { userid, username, email, password } = req.body;

  try {
    let pool = await sql.connect(config2);

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool
      .request()
      .input("UserID", sql.VarChar, userid)
      .input("Username", sql.VarChar, username)
      .input("Email", sql.VarChar, email)
      .input("Password", sql.VarChar, hashedPassword)
      .query(
        "INSERT INTO project.project.users (UserID, Username, Email, Password) VALUES (@UserID, @Username, @Email, @Password)"
      );
    pool.close();
    res.redirect("/login");
  } catch (error) {
    console.error("Error hashing password:", error);
    res.status(500).send("Error signing up");
  }
});

router.get("/emp_master", async (req, res) => {
  const location = req.query.location || "";

  try {
    // Connect to the database
    let site = req.query.site;
    let pool = await sql.connect(config);

    // Query for employees based on location
    //   const employeeQuery = `
    //   SELECT e.employee_id, e.first_name, d.employee_designation_type_name, dp.department_name, middle_name, last_name,site_name
    //   FROM [HLS_DB].[hls_schema_common].[tbl_employee_details] e
    //   JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id= dsd.ref_id
    //   JOIN [HLS_DB].[hls_schema_common].[tbl_department_details] dp ON dsd.department_id = dp.department_id
    //   JOIN [HLS_DB].[hls_schema_common].[tbl_site_details] dst ON dsd.site_id = dst.site_id
    //   JOIN [HLS_DB].[hls_schema_common].[tbl_employee_designation_type_details] d ON d.employee_designation_type_id=e.designation_id

    //   where dst.site_name=@site

    // `;
    // console.log("Executing employeeQuery on pool1");
    // console.log(site)
    // const result = await pool1.request().input('site', sql.VarChar, site).query(employeeQuery);

    // console.log(result)
    // const sitesquery=`
    // SELECT DISTINCT [site_name]
    // FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
    // `;
    // console.log("Executing sitesquery");
    // const siteResult = await pool1.request().query(sitesquery);

    let query = `
      SELECT e.employee_id, e.first_name,d.employee_designation_type_name,dp.department_name
      FROM [HLS_DB].[hls_schema_common].[tbl_employee_details] e
      JOIN [HLS_DB].[hls_schema_common].[tbl_employee_designation_type_details] d ON e.employee_type_id = d.employee_designation_type_id
      JOIN [HLS_DB].[hls_schema_common].[tbl_department_details] dp ON e.department_site_ref_id = dp.department_id
    `;

    const result = await pool.request().query(query);

    await pool.close();

    res.render("emp_master", {
      title: "Employee Master",
      employees: result.recordset,
      // locations: locationResult.recordset,
      // selectedLocation: location,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

router.get("/punching", async (req, res) => {
  if (req.session.user) {
    const defaultTime1 = "10:00:00";
    const defaultTime2 = "10:15:00";
    let time1 = req.query.time1 || defaultTime1;
    let time2 = req.query.time2 || defaultTime2;
    let fromDate = req.query.fromDate;
    const site = req.query.site;
    let toDate = req.query.toDate;

    if (!fromDate || !toDate || !site) {
      try {
        const pool1 = await sql.connect(config);
        // Fetch available locations for the dropdown
        const sitesquery = `
  SELECT DISTINCT [site_name]
  FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
  `;
        console.log("Executing sitesquery");
        const siteResult = await pool1.request().query(sitesquery);
        pool1.close();
        // Render the form with locations
        return res.render("punching", {
          sites: siteResult.recordset,
          time1,
          time2,
        });
      } catch (error) {
        console.error("Error fetching locations:", error);
        return res.status(500).send("Server error");
      }
    }
    try {
      await sql.connect(config);

      const sitesquery = `
      SELECT DISTINCT [site_name]
      FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
      `;
      console.log("Executing sitesquery");
      const siteResult = await new sql.Request().query(sitesquery);
      console.log(siteResult.recordset);
      const query = `
      WITH FirstPunchCTE AS (
        SELECT
            p.employee_id,
            CAST(p.rec_timestamp AS DATE) AS PunchDate,
            MIN(p.rec_timestamp) AS FirstPunchDateTime
        FROM [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
        WHERE p.rec_timestamp >= @fromDate AND p.rec_timestamp < DATEADD(DAY, 1, @toDate)
        GROUP BY p.employee_id, CAST(p.rec_timestamp AS DATE)
        )

        SELECT TOP 1000
            p.employee_id,
            dp.department_name,
            e.first_name,
            d.employee_designation_type_name,
            FORMAT(p.rec_timestamp, 'ddd MMM dd yyyy HH:mm:ss') AS rec_timestamp,
            CASE
                WHEN CAST(p.rec_timestamp AS TIME) > @time1 THEN 'YES'
                ELSE 'ON TIME'
            END AS IsLateAfterTime1,
            CASE
                WHEN CAST(p.rec_timestamp AS TIME) > @time1 THEN
                    CONVERT(VARCHAR, DATEADD(SECOND, DATEDIFF(SECOND, @time1, CAST(p.rec_timestamp AS TIME)), 0), 108)
                ELSE '0:00:00'
            END AS DelayedFromTime1,
            CASE
                WHEN CAST(p.rec_timestamp AS TIME) > @time2 THEN 'YES'
                ELSE 'CAME BEFORE ' + @time2
            END AS IsLateAfterTime2,
            CASE
                WHEN CAST(p.rec_timestamp AS TIME) > @time2 THEN
                    CONVERT(VARCHAR, DATEADD(SECOND, DATEDIFF(SECOND, @time2, CAST(p.rec_timestamp AS TIME)), 0), 108)
                ELSE '0:00:00'
            END AS DelayedFromTime2,
            DATEPART(WEEKDAY, p.rec_timestamp) - 1 AS DOWeek
        FROM [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
        JOIN FirstPunchCTE fp ON p.employee_id = fp.employee_id AND p.rec_timestamp = fp.FirstPunchDateTime
        JOIN [HLS_DB].[hls_schema_common].[tbl_employee_details] e ON p.employee_id = e.employee_id
         JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id= dsd.ref_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_department_details] dp ON dsd.department_id = dp.department_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_site_details] dst ON dsd.site_id = dst.site_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_employee_designation_type_details] d ON e.employee_type_id = d.employee_designation_type_id
        where dst.site_name=@site
      `;

      const request = new sql.Request();
      request.input("time1", sql.VarChar, time1);
      request.input("time2", sql.VarChar, time2);
      // request.input('month',sql.VarChar,month);
      request.input("fromDate", sql.DateTime, fromDate);
      request.input("site", sql.VarChar, site);
      request.input("toDate", sql.DateTime, toDate);
      const result = await request.query(query);

      await sql.close();
      const results = result.recordset;
      const lateAfterTime1Count = results.filter(
        (r) => r.IsLateAfterTime1 === "YES"
      ).length;
      const onTimeAfterTime1Count = results.filter(
        (r) => r.IsLateAfterTime1 === "ON TIME"
      ).length;
      const lateAfterTime2Count = results.filter(
        (r) => r.IsLateAfterTime2 === "YES"
      ).length;
      const onTimeAfterTime2Count = results.filter(
        (r) => r.IsLateAfterTime2 === `CAME BEFORE ${time2}`
      ).length;
      console.log(fromDate, toDate);
      res.render("punching", {
        title: "Punching Data",
        data: results,
        time1: time1,
        time2: time2,
        lateAfterTime1Count,
        onTimeAfterTime1Count,
        lateAfterTime2Count,
        onTimeAfterTime2Count,
        sites: siteResult.recordset,
        fromDate,
        toDate,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send(err.message);
    }
  } else {
    res.redirect("/");
  }
});

router.get("/leaveinfo", async (req, res) => {
  if (req.session.user) {
    try {
      await sql.connect(config2);
      const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

      const query = `
        SELECT l.PERNR, l.BEGDA, l.ENDDA,
          (DATEDIFF(DAY, l.BEGDA, l.ENDDA) + 1 
          - ((DATEPART(WEEK, l.ENDDA) - DATEPART(WEEK, l.BEGDA)) * 2)
          - (CASE WHEN DATEPART(WEEKDAY, l.BEGDA) = 1 THEN 1 ELSE 0 END)
          - (CASE WHEN DATEPART(WEEKDAY, l.ENDDA) = 7 THEN 1 ELSE 0 END)
          ) AS TotalTourDaysExcludingWeekends,
          e.name, e.level, e.org_unit_text as Section
        FROM project.project.leaveinfo l
        JOIN project.project.employeedetails e ON l.PERNR = e.CPF_NO;
      `;

      const results = await sql.query(query);

      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT l.PERNR,
            (DATEDIFF(DAY, l.BEGDA, l.ENDDA) + 1
            - ((DATEPART(WEEK, l.ENDDA) - DATEPART(WEEK, l.BEGDA)) * 2)
            - (CASE WHEN DATEPART(WEEKDAY, l.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DATEPART(WEEKDAY, l.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            l.BEGDA,
            l.ENDDA
          FROM project.project.leaveinfo l
        ) AS LeaveDays
        GROUP BY PERNR;
      `;

      const totalsResults = await sql.query(totalsQuery);
      await sql.close();
      const finalResults = results.recordset.map((row) => {
        const totalDays = totalsResults.recordset.find(
          (t) => t.PERNR === row.PERNR
        );

        let holidayCount = 0;
        let holidayList = [];

        const begdaDate = new Date(row.BEGDA);
        begdaDate.setHours(0, 0, 0, 0);
        const enddaDate = new Date(row.ENDDA);
        enddaDate.setHours(0, 0, 0, 0);

        const holidayDates = holidays.map((holiday) => {
          const date = new Date(holiday);
          date.setHours(0, 0, 0, 0);
          return date;
        });

        for (
          let d = new Date(begdaDate);
          d <= enddaDate;
          d.setDate(d.getDate() + 1)
        ) {
          if (
            holidayDates.some((holiday) => holiday.getTime() === d.getTime())
          ) {
            holidayCount += 1;
            holidayList.push(formatDate(d));
          }
        }

        const adjustedTotalTourDays = totalDays
          ? totalDays.TotalTourDaysWithoutDuplication - holidayCount
          : 0;

        return {
          ...row,
          ENDDA: formatDate(row.ENDDA),
          BEGDA: formatDate(row.BEGDA),
          TotalTourDaysWithoutDuplication: adjustedTotalTourDays,
          Holiday: holidayList.length > 0 ? holidayList.join(", ") : null,
        };
      });

      res.render("leaveinfo", {
        title: "Leave Information",
        data: finalResults,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  } else {
    res.redirect("/");
  }
});

router.get("/leavereport", async (req, res) => {
  if (req.session.user) {
    const { site } = req.query.site;
    const record_date = req.query.record_date
      ? new Date(req.query.record_date).toISOString().split("T")[0]
      : null;

    const siteQuery = `
     SELECT DISTINCT [site_name]
      FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
    `;

    // const dateQuery = `
    //   SELECT DISTINCT
    //     FORMAT(
    //       TRY_CONVERT(DATE,
    //         SUBSTRING(a.punching_time, 10, 10),
    //         103
    //       ), 'yyyy-MM-dd'
    //     ) AS record_date
    //   FROM
    //     [HLS_DB].[hls_schema_common].attendance_sitewise_report a
    //   INNER JOIN
    //     [HLS_DB].[hls_schema_common].tbl_ned_employee_details e ON a.Employee_ID = e.CPF_NO
    //   WHERE
    //     (@location = '' OR e.Location = @location)
    //   ORDER BY
    //     record_date;
    // `;

    let dataQuery = `
      SELECT
    a.Employee_ID,
    e.Name,
    e.Designation_TEXT,
    SUBSTRING(a.punching_time, 1, CHARINDEX(' ', a.punching_time) - 1) AS punch_in_time,
            SUBSTRING(
                a.punching_time,
                CHARINDEX(' ', a.punching_time) + 1,
                CHARINDEX('(I)', a.punching_time) - CHARINDEX(' ', a.punching_time) - 1
            ) AS DATE,
    CONVERT(VARCHAR(8),
        DATEADD(SECOND,
            DATEDIFF(SECOND, '09:45:00', CAST(SUBSTRING(a.punching_time, 1, CHARINDEX(' ', a.punching_time) - 1) AS TIME)),
        0), 108) AS LATEBY,
    e.Location
FROM 
    [HLS_DB].[hls_schema_common].attendance_sitewise_report a
inner JOIN 
    [HLS_DB].[hls_schema_common].tbl_ned_employee_details e ON a.Employee_ID = e.CPF_NO
      WHERE 
        (@location = '' OR e.Location = @location)
        AND
        (@record_date IS NULL OR FORMAT(
            TRY_CONVERT(DATE, 
                SUBSTRING(a.punching_time, 10, 10), 
                103
            ), 'yyyy-MM-dd') = @record_date)
    `;

    const request = new sql.Request();
    request.input("location", sql.VarChar, location || "");
    request.input("record_date", sql.VarChar, record_date || null);

    try {
      const locationResults = await request.query(locationQuery);
      const dateResults = await request.query(dateQuery);
      const dataResults = await request.query(dataQuery);
      res.render("Daily_sitewise_attendance", {
        title: "Employees Daily Attendance Summary Sitewise Report",
        data: dataResults.recordset,
        locations: locationResults.recordset,
        dates: dateResults.recordset,
        selectedLocation: location,
        selectedDate: record_date,
      });
    } catch (err) {
      console.error("Query Error:", err);
      res.status(500).send("Database Error");
    }
  } else {
    res.redirect("/");
  }
});

router.get("/tourinfo", async (req, res) => {
  if (req.session.user) {
    try {
      await sql.connect(config2);
      const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

      const query = `
        SELECT t.PERNR, t.BEGDA, t.ENDDA,
          (DATEDIFF(DAY, t.BEGDA, t.ENDDA) + 1 
          - ((DATEDIFF(DAY, t.BEGDA, t.ENDDA) / 7) * 2)
          - (CASE WHEN DATEPART(WEEKDAY, t.BEGDA) = 1 THEN 1 ELSE 0 END)
          - (CASE WHEN DATEPART(WEEKDAY, t.ENDDA) = 7 THEN 1 ELSE 0 END)
          ) AS TotalTourDaysExcludingWeekends,
          e.name, e.level, e.org_unit_text as Section
        FROM project.project.tourtable t
        JOIN project.project.employeedetails e ON t.PERNR = e.CPF_NO;
      `;

      const results = await sql.query(query);

      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT t.PERNR,
            (DATEDIFF(DAY, t.BEGDA, t.ENDDA) + 1
            - ((DATEDIFF(DAY, t.BEGDA, t.ENDDA) / 7) * 2)
            - (CASE WHEN DATEPART(WEEKDAY, t.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DATEPART(WEEKDAY, t.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            t.BEGDA,
            t.ENDDA
          FROM project.project.tourtable t
        ) AS TourDays
        GROUP BY PERNR;
      `;

      const totalsResults = await sql.query(totalsQuery);
      await sql.close();
      const finalResults = results.recordset.map((row) => {
        const totalDays = totalsResults.recordset.find(
          (t) => t.PERNR === row.PERNR
        );

        let holidayCount = 0;
        let holidayList = [];

        const begdaDate = new Date(row.BEGDA);
        begdaDate.setHours(0, 0, 0, 0);
        const enddaDate = new Date(row.ENDDA);
        enddaDate.setHours(0, 0, 0, 0);

        const holidayDates = holidays.map((holiday) => {
          const date = new Date(holiday);
          date.setHours(0, 0, 0, 0);
          return date;
        });

        for (
          let d = new Date(begdaDate);
          d <= enddaDate;
          d.setDate(d.getDate() + 1)
        ) {
          if (
            holidayDates.some((holiday) => holiday.getTime() === d.getTime())
          ) {
            holidayCount += 1;
            holidayList.push(formatDate(d));
          }
        }

        const adjustedTotalTourDays = totalDays
          ? totalDays.TotalTourDaysWithoutDuplication - holidayCount
          : 0;

        return {
          ...row,
          ENDDA: formatDate(row.ENDDA),
          BEGDA: formatDate(row.BEGDA),
          TotalTourDaysWithoutDuplication: adjustedTotalTourDays,
          Holiday: holidayList.length > 0 ? holidayList.join(", ") : null,
        };
      });

      res.render("tour", {
        title: "Tour Information",
        data: finalResults,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  } else {
    res.redirect("/");
  }
});

router.get("/monthlyreport", async (req, res) => {
  if (req.session.user) {
    const { fromDate, toDate } = req.query;
    const site = req.query.site || "All Sites";
    let pool1 = await sql.connect(config);
    const defaultTime1 = "10:00:00";
    const defaultTime2 = "10:15:00";
    let time1 = req.query.time1 || defaultTime1;
    let time2 = req.query.time2 || defaultTime2;

    if (!fromDate || !toDate || !site) {
      try {
        const pool = await sql.connect(config2);
        // Fetch available locations for the dropdown
        const sitesquery = `
      SELECT DISTINCT [site_name]
      FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
      `;
        console.log("Executing sitesquery");
        const siteResult = await pool1.request().query(sitesquery);
        pool.close();
        // Render the form with locations
        return res.render("monthlyReport", { sites: siteResult.recordset });
      } catch (error) {
        console.error("Error fetching locations:", error);
        return res.status(500).send("Server error");
      }
    }

    try {
      // Query 1: Fetch employee details from server1 (pool1)
      const employeeQuery = `
        SELECT e.employee_id, e.first_name, d.employee_designation_type_name, dp.department_name, middle_name, last_name,site_name
        FROM [HLS_DB].[hls_schema_common].[tbl_employee_details] e
        JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id= dsd.ref_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_department_details] dp ON dsd.department_id = dp.department_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_site_details] dst ON dsd.site_id = dst.site_id
        JOIN [HLS_DB].[hls_schema_common].[tbl_employee_designation_type_details] d ON d.employee_designation_type_id=e.designation_id

        where (dst.site_name=@site OR @site='ALL Sites')
        
      `;
      console.log("Executing employeeQuery on pool1");
      const employeeResult = await pool1
        .request()
        .input("site", sql.VarChar, site)
        .query(employeeQuery);

      const sitesquery = `
      SELECT DISTINCT [site_name]
      FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
      `;
      console.log("Executing sitesquery");
      const siteResult = await pool1.request().query(sitesquery);

      // Query 2: Fetch punch data from server2 (pool2)
      const punchDataQuery = `
        WITH FirstPunches AS (
    SELECT
        p.employee_id,
        MIN(p.rec_timestamp) AS FirstPunchTimestamp
    FROM
        [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
    WHERE
        p.rec_timestamp >= @fromDate AND p.rec_timestamp < DATEADD(DAY, 1, @toDate)
    GROUP BY
        p.employee_id, 
        CAST(p.rec_timestamp AS DATE)
)
SELECT 
    fp.employee_id AS Employee_ID,
    COUNT(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > @time1 THEN 1 END) AS NoOfDaysBeyond10,
    SUM(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > @time1 THEN 
        CAST(DATEDIFF(SECOND, @time1, CAST(fp.FirstPunchTimestamp AS TIME)) AS BIGINT)
    END) AS TotalTimeDelayBeyond10InSeconds,

    COUNT(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > @time2 THEN 1 END) AS NoOfDaysBeyond1015,
    SUM(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > @time2 THEN 
        CAST(DATEDIFF(SECOND, @time2, CAST(fp.FirstPunchTimestamp AS TIME)) AS BIGINT)
    END) AS TotalTimeDelayBeyond1015InSeconds
FROM 
    FirstPunches fp

GROUP BY 
    fp.employee_id;

      `;
      console.log("Executing punchDataQuery on pool2");
      const punchDataResult = await pool1
        .request()
        .input("fromDate", sql.VarChar, fromDate)
        .input("toDate", sql.VarChar, toDate)
        .input("time1", sql.VarChar, time1)
        .input("time2", sql.VarChar, time2)
        .query(punchDataQuery);
      await pool1.close();

      let pool2 = await sql.connect(config2);
      // Query 3: Fetch leave days from server2 (pool2)
      const leaveDaysQuery = `
        SELECT l.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT li.PERNR,
            (DATEDIFF(DAY, li.BEGDA, li.ENDDA) + 1
            - ((DATEDIFF(WEEK, li.BEGDA, li.ENDDA)) * 2)
            - (CASE WHEN DATEPART(WEEKDAY, li.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DATEPART(WEEKDAY, li.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM project.project.leaveinfo li
          WHERE li.BEGDA >= @fromDate AND li.ENDDA <= @toDate
        ) AS l  
        GROUP BY l.PERNR
      `;
      console.log("Executing leaveDaysQuery on pool2");
      const leaveDaysResult = await pool2
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(leaveDaysQuery);

      // Query 4: Fetch tour days from server2 (pool2)
      const tourDaysQuery = `
        SELECT t.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT tt.PERNR,
            (DATEDIFF(DAY, tt.BEGDA, tt.ENDDA) + 1
            - ((DATEDIFF(WEEK, tt.BEGDA, tt.ENDDA)) * 2)
            - (CASE WHEN DATEPART(WEEKDAY, tt.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DATEPART(WEEKDAY, tt.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM project.project.TourTable tt
          WHERE tt.BEGDA >= @fromDate AND tt.ENDDA <= @toDate
        ) AS t
        GROUP BY t.PERNR
      `;
      console.log("Executing tourDaysQuery on pool2");
      const tourDaysResult = await pool2
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(tourDaysQuery);

      // Query 5: Fetch absentee data from server2 (pool2)
      await pool2.close();
      // Query for absentees data

      const absenteesQuery = `
WITH WorkingDays AS (
    SELECT CAST(@fromDate AS DATE) AS WorkDate
    UNION ALL
    SELECT DATEADD(DAY, 1, WorkDate)
    FROM WorkingDays
    WHERE DATEADD(DAY, 1, WorkDate) <= @toDate
),
FilteredWorkingDays AS (
    SELECT WorkDate
    FROM WorkingDays
    WHERE DATENAME(WEEKDAY, WorkDate) IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
),
PresentDays AS (
    SELECT 
        p.employee_id AS Employee_ID,
        COUNT(DISTINCT CAST(p.rec_timestamp AS DATE)) AS PresentDays
    FROM 
        [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
    WHERE 
        p.rec_timestamp >= @fromDate AND p.rec_timestamp < DATEADD(DAY, 1, @toDate)
    GROUP BY 
        p.employee_id
),
TotalWorkingDays AS (
    SELECT COUNT(WorkDate) AS TotalDays
    FROM FilteredWorkingDays
)
SELECT 
    e.employee_id AS Employee_ID,
    ISNULL(twd.TotalDays, 0) AS TotalWorkingDays,
    ISNULL(pd.PresentDays, 0) AS PresentDays,
    CASE 
        WHEN ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0) < 0 THEN 0
        ELSE ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0)
    END AS AbsentDays
FROM 
    [HLS_DB].[hls_schema_common].[tbl_employee_details] e
CROSS JOIN 
    TotalWorkingDays twd
LEFT JOIN 
    PresentDays pd ON e.employee_id = pd.Employee_ID;

    
          `;
      console.log("Executing absenteesQuery");
      // requestAbsentees.input('monthFilter', sql.VarChar, monthFilter);
      // requestAbsentees.input('locationFilter', sql.VarChar, locationFilter);
      pool1 = await sql.connect(config);
      const absenteesResult = await pool1
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(absenteesQuery);

      await pool1.close();
      pool2 = await sql.connect(config2);
      // Query for level-wise late punches
      const levelWiseLatePunchesQuery = `
    SELECT e.LEVEL AS EmployeeLevel,
      COUNT(DISTINCT LatePunchSubquery.ID) AS LatePunches
    FROM (
      SELECT p.ID
      FROM project.Punch_data p
      WHERE CAST(p.PunchDateTime AS TIME) > '10:15:00'
      GROUP BY p.ID, FORMAT(p.PunchDateTime, 'yyyy-MM')
    ) AS LatePunchSubquery
    JOIN project.employeedetails e ON LatePunchSubquery.ID = e.CPF_NO
    WHERE e.LEVEL LIKE 'E_%'
    GROUP BY e.LEVEL
    ORDER BY e.LEVEL DESC;
  `;
      const requestLevelWiseLatePunches = pool2.request();
      // requestLevelWiseLatePunches.input('monthFilter', sql.VarChar, monthFilter);
      // requestLevelWiseLatePunches.input('locationFilter', sql.VarChar, locationFilter);
      const levelWiseLatePunchesResult =
        await requestLevelWiseLatePunches.query(levelWiseLatePunchesQuery);

      // Query for summarized late punches
      const sumLevelWiseLatePunchesQuery = `
    SELECT 
      CASE 
        WHEN LatePunchSubquery.LEVEL LIKE 'E%' THEN 'E% Levels'
        ELSE 'Other Levels'
      END AS EmployeeLevelCategory,
      COUNT(DISTINCT LatePunchSubquery.ID) AS LatePunches
    FROM (
      SELECT p.ID, e.LEVEL
      FROM project.Punch_data p 
      JOIN project.employeedetails e ON p.ID = e.CPF_NO
      WHERE CAST(p.PunchDateTime AS TIME) > '10:15:00'
      GROUP BY p.ID, e.LEVEL
    ) AS LatePunchSubquery
    GROUP BY 
      CASE 
        WHEN LatePunchSubquery.LEVEL LIKE 'E%' THEN 'E% Levels'
        ELSE 'Other Levels'
      END
    ORDER BY EmployeeLevelCategory DESC;
  `;
      const requestSumLevelWiseLatePunches = pool2.request();
      // requestSumLevelWiseLatePunches.input('monthFilter', sql.VarChar, monthFilter);
      // requestSumLevelWiseLatePunches.input('locationFilter', sql.VarChar, locationFilter);
      const sumLevelWiseLatePunchesResult =
        await requestSumLevelWiseLatePunches.query(
          sumLevelWiseLatePunchesQuery
        );

      // Query for overall statistics summary
      const summaryQuery = `
    DECLARE @workingDays INT;
    SET @workingDays = (
      SELECT COUNT(DISTINCT FORMAT(PunchDateTime, 'yyyy-MM-dd'))
      FROM project.Punch_data
    );

    DECLARE @totalEmployees INT;
    SET @totalEmployees = (
      SELECT COUNT(DISTINCT e.CPF_NO)
      FROM project.employeedetails e
      JOIN project.Punch_data p ON e.CPF_NO = p.ID
    );

    DECLARE @latePunches10_00 INT;
    SET @latePunches10_00 = (
      SELECT COUNT(Distinct ID)
      FROM project.Punch_data p
      WHERE CAST(p.PunchDateTime AS TIME) > @time1
    );

    DECLARE @latePunches10_15 INT;
    SET @latePunches10_15 = (
      SELECT COUNT(distinct ID)
      FROM project.Punch_data p
      WHERE CAST(p.PunchDateTime AS TIME) > @time2
    );

    SELECT 
      @workingDays AS [No_of_Working_Days_in_the_Month],
      @totalEmployees AS [Total_Employees_in_the_Month],
      @latePunches10_00 AS [No_of_Times_beyond_Time1],
      @latePunches10_15 AS [No_of_Times_beyond_Time2];
  `;
      const requestSummary = pool2
        .request()
        .input("time1", sql.VarChar, time1)
        .input("time2", sql.VarChar, time2);
      const summaryResult = await requestSummary.query(summaryQuery);
      console.log(summaryResult);

      await pool2.close(); // Close pool2 after fetching data

      // Combine the results based on employee ID
      const combinedResults = employeeResult.recordset.map((employee) => {
        const punchData =
          punchDataResult.recordset.find(
            (p) => p.Employee_ID == employee.employee_id
          ) || {};
        const leaveData =
          leaveDaysResult.recordset.find(
            (l) => l.Employee_ID == employee.employee_id
          ) || {};
        const tourData =
          tourDaysResult.recordset.find(
            (t) => t.Employee_ID == employee.employee_id
          ) || {};
        const absenteeData =
          absenteesResult.recordset.find(
            (a) => a.Employee_ID == employee.employee_id
          ) || {};

        return {
          ...employee,
          NoOfDaysBeyond10: punchData.NoOfDaysBeyond10 || 0,
          TotalTimeDelayBeyond10: punchData.TotalTimeDelayBeyond10InSeconds
            ? formatTime(punchData.TotalTimeDelayBeyond10InSeconds)
            : "00:00:00",
          NoOfDaysBeyond1015: punchData.NoOfDaysBeyond1015 || 0,
          TotalTimeDelayBeyond1015: punchData.TotalTimeDelayBeyond1015InSeconds
            ? formatTime(punchData.TotalTimeDelayBeyond1015InSeconds)
            : "00:00:00",
          TotalEACSAbsentDays: absenteeData.AbsentDays || 0,
          TotalLeaveDays: leaveData.TotalTourDaysWithoutDuplication || 0,
          TotalDaysOnTour: tourData.TotalTourDaysWithoutDuplication || 0,
        };
      });
      const punchData = punchDataResult.recordset;
      const leaveDays = leaveDaysResult.recordset;
      const tourDays = tourDaysResult.recordset;

      const combinedData = punchData.map((punch) => {
        const employeeLeaveDays =
          leaveDays.find((l) => l.Employee_ID == punch.Employee_ID) || {};
        const employeeTourDays =
          tourDays.find((t) => t.Employee_ID == punch.Employee_ID) || {};
        return {
          ...punch,
          TotalLeaveDays: employeeLeaveDays.TotalLeaveDays || 0,
          TotalTourDays: employeeTourDays.TotalTourDays || 0,
        };
      });

      const latePunchesStatistics = {
        ">80%": { Beyond10: 0, Beyond1015: 0 },
        "70-80%": { Beyond10: 0, Beyond1015: 0 },
        "60-70%": { Beyond10: 0, Beyond1015: 0 },
        "50-60%": { Beyond10: 0, Beyond1015: 0 },
        "40-50%": { Beyond10: 0, Beyond1015: 0 },
        "30-40%": { Beyond10: 0, Beyond1015: 0 },
        "20-30%": { Beyond10: 0, Beyond1015: 0 },
        "<20%": { Beyond10: 0, Beyond1015: 0 },
      };

      const totalWorkingDays =
        summaryResult.recordset[0].No_of_Working_Days_in_the_Month;

      punchDataResult.recordset.forEach((record) => {
        const daysBeyond10Percent =
          (record.NoOfDaysBeyond10 / totalWorkingDays) * 100;
        const daysBeyond1015Percent =
          (record.NoOfDaysBeyond1015 / totalWorkingDays) * 100;

        const range = getRange(daysBeyond10Percent);
        if (range) {
          latePunchesStatistics[range].Beyond10++;
        }

        const range1015 = getRange(daysBeyond1015Percent);
        if (range1015) {
          latePunchesStatistics[range1015].Beyond1015++;
        }
      });

      function getRange(percent) {
        if (percent > 80) return ">80%";
        if (percent > 70) return "70-80%";
        if (percent > 60) return "60-70%";
        if (percent > 50) return "50-60%";
        if (percent > 40) return "40-50%";
        if (percent > 30) return "30-40%";
        if (percent > 20) return "20-30%";
        if (percent <= 20) return "<20%";
        return null;
      }

      const statistics = {
        levelWiseLatePunches: levelWiseLatePunchesResult.recordset,
        sumLevelWiseLatePunches: sumLevelWiseLatePunchesResult.recordset,
        sumlevelwiseofothers: sumLevelWiseLatePunchesResult.recordset[1],
        sumlevelwiseofE: sumLevelWiseLatePunchesResult.recordset[0],
        summary: summaryResult.recordset[0],
      };
      console.log(statistics);
      res.render("monthlyreport", {
        title: "Monthly Attendance Report",
        data: combinedResults,
        statistics,
        latePunchesStatistics,
        sites: siteResult.recordset,
        time1,
        time2,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  } else {
    res.redirect("/");
  }
});

router.get("/download/monthlyreport", async (req, res) => {
  if (req.session.user) {
    const { fromDate, toDate } = req.query;
    const site = req.query.site || "All Sites";
    let pool1 = await sql.connect(config);
    let pool2 = await sql.connect(config2);

    if (!fromDate || !toDate || !site) {
      return res.status(400).send("fromDate, toDate, and site are required.");
    }

    try {
      // Query 1: Fetch employee details from server1 (pool1)
      const employeeQuery = `
            SELECT e.employee_id, e.first_name, d.employee_designation_type_name, dp.department_name, middle_name, last_name,site_name
            FROM [HLS_DB].[hls_schema_common].[tbl_employee_details] e
            JOIN [HLS_DB].[hls_schema_common].[tbl_department_site_details] dsd ON e.department_site_ref_id= dsd.ref_id
            JOIN [HLS_DB].[hls_schema_common].[tbl_department_details] dp ON dsd.department_id = dp.department_id
            JOIN [HLS_DB].[hls_schema_common].[tbl_site_details] dst ON dsd.site_id = dst.site_id
            JOIN [HLS_DB].[hls_schema_common].[tbl_employee_designation_type_details] d ON d.employee_designation_type_id=e.designation_id
    
            where (dst.site_name=@site OR @site='ALL Sites')
            
          `;
      console.log("Executing employeeQuery on pool1");
      const employeeResult = await pool1
        .request()
        .input("site", sql.VarChar, site)
        .query(employeeQuery);

      const sitesquery = `
          SELECT DISTINCT [site_name]
          FROM [HLS_DB].[hls_schema_common].[tbl_site_details]
          `;
      console.log("Executing sitesquery");
      const siteResult = await pool1.request().query(sitesquery);

      // Query 2: Fetch punch data from server2 (pool2)
      const punchDataQuery = `
            WITH FirstPunches AS (
        SELECT
            p.employee_id,
            MIN(p.rec_timestamp) AS FirstPunchTimestamp
        FROM
            [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
        WHERE
            p.rec_timestamp >= @fromDate AND p.rec_timestamp < DATEADD(DAY, 1, @toDate)
        GROUP BY
            p.employee_id, 
            CAST(p.rec_timestamp AS DATE)
    )
    SELECT 
        fp.employee_id AS Employee_ID,
        COUNT(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > '10:00:00' THEN 1 END) AS NoOfDaysBeyond10,
        SUM(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > '10:00:00' THEN 
            CAST(DATEDIFF(SECOND, '10:00:00', CAST(fp.FirstPunchTimestamp AS TIME)) AS BIGINT)
        END) AS TotalTimeDelayBeyond10InSeconds,
    
        COUNT(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > '10:15:00' THEN 1 END) AS NoOfDaysBeyond1015,
        SUM(CASE WHEN CAST(fp.FirstPunchTimestamp AS TIME) > '10:15:00' THEN 
            CAST(DATEDIFF(SECOND, '10:15:00', CAST(fp.FirstPunchTimestamp AS TIME)) AS BIGINT)
        END) AS TotalTimeDelayBeyond1015InSeconds
    FROM 
        FirstPunches fp
    
    GROUP BY 
        fp.employee_id;
    
          `;
      console.log("Executing punchDataQuery on pool2");
      const punchDataResult = await pool1
        .request()
        .input("fromDate", sql.VarChar, fromDate)
        .input("toDate", sql.VarChar, toDate)
        .query(punchDataQuery);
      await pool1.close();

      let pool2 = await sql.connect(config2);
      // Query 3: Fetch leave days from server2 (pool2)
      const leaveDaysQuery = `
            SELECT l.PERNR AS Employee_ID, 
              SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
            FROM (
              SELECT li.PERNR,
                (DATEDIFF(DAY, li.BEGDA, li.ENDDA) + 1
                - ((DATEDIFF(WEEK, li.BEGDA, li.ENDDA)) * 2)
                - (CASE WHEN DATEPART(WEEKDAY, li.BEGDA) = 1 THEN 1 ELSE 0 END)
                - (CASE WHEN DATEPART(WEEKDAY, li.ENDDA) = 7 THEN 1 ELSE 0 END)
                ) AS TotalTourDaysExcludingWeekends
              FROM project.project.leaveinfo li
              WHERE li.BEGDA >= @fromDate AND li.ENDDA <= @toDate
            ) AS l  
            GROUP BY l.PERNR
          `;
      console.log("Executing leaveDaysQuery on pool2");
      const leaveDaysResult = await pool2
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(leaveDaysQuery);

      // Query 4: Fetch tour days from server2 (pool2)
      const tourDaysQuery = `
            SELECT t.PERNR AS Employee_ID, 
              SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
            FROM (
              SELECT tt.PERNR,
                (DATEDIFF(DAY, tt.BEGDA, tt.ENDDA) + 1
                - ((DATEDIFF(WEEK, tt.BEGDA, tt.ENDDA)) * 2)
                - (CASE WHEN DATEPART(WEEKDAY, tt.BEGDA) = 1 THEN 1 ELSE 0 END)
                - (CASE WHEN DATEPART(WEEKDAY, tt.ENDDA) = 7 THEN 1 ELSE 0 END)
                ) AS TotalTourDaysExcludingWeekends
              FROM project.project.TourTable tt
              WHERE tt.BEGDA >= @fromDate AND tt.ENDDA <= @toDate
            ) AS t
            GROUP BY t.PERNR
          `;
      console.log("Executing tourDaysQuery on pool2");
      const tourDaysResult = await pool2
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(tourDaysQuery);

      // Query 5: Fetch absentee data from server2 (pool2)
      await pool2.close();
      // Query for absentees data

      const absenteesQuery = `
    WITH WorkingDays AS (
        -- Generate all dates between @fromDate and @toDate
        SELECT CAST(@fromDate AS DATE) AS WorkDate
        UNION ALL
        SELECT DATEADD(DAY, 1, WorkDate)
        FROM WorkingDays
        WHERE DATEADD(DAY, 1, WorkDate) <= @toDate
    ),
    FilteredWorkingDays AS (
        -- Filter to include only Monday to Friday and exclude company holidays
        SELECT WorkDate
        FROM WorkingDays
        WHERE DATENAME(WEEKDAY, WorkDate) IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
    ),
    PresentDays AS (
        -- Get the distinct days each employee punched in
        SELECT 
            p.employee_id AS Employee_ID,
            COUNT(DISTINCT CAST(p.rec_timestamp AS DATE)) AS PresentDays
        FROM 
            [HLS_DB].[hls_schema_acs_share].[tbl_attendance_raw_data] p
        WHERE 
            p.rec_timestamp >= @fromDate AND p.rec_timestamp < DATEADD(DAY, 1, @toDate)
        GROUP BY 
            p.employee_id
    ),
    TotalWorkingDays AS (
        -- Get total working days count
        SELECT COUNT(WorkDate) AS TotalDays
        FROM FilteredWorkingDays
    )
    SELECT 
        e.employee_id AS Employee_ID,
        ISNULL(twd.TotalDays, 0) AS TotalWorkingDays,
        ISNULL(pd.PresentDays, 0) AS PresentDays,
        CASE 
            WHEN ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0) < 0 THEN 0
            ELSE ISNULL(twd.TotalDays, 0) - ISNULL(pd.PresentDays, 0)
        END AS AbsentDays
    FROM 
        [HLS_DB].[hls_schema_common].[tbl_employee_details] e
    CROSS JOIN 
        TotalWorkingDays twd
    LEFT JOIN 
        PresentDays pd ON e.employee_id = pd.Employee_ID;
    
        
              `;
      console.log("Executing absenteesQuery");
      // requestAbsentees.input('monthFilter', sql.VarChar, monthFilter);
      // requestAbsentees.input('locationFilter', sql.VarChar, locationFilter);
      pool1 = await sql.connect(config);
      const absenteesResult = await pool1
        .request()
        .input("fromDate", sql.DateTime, fromDate)
        .input("toDate", sql.DateTime, toDate)
        .query(absenteesQuery);

      await pool1.close();
      pool2 = await sql.connect(config2);
      // Query for level-wise late punches
      const levelWiseLatePunchesQuery = `
        SELECT e.LEVEL AS EmployeeLevel,
          COUNT(DISTINCT LatePunchSubquery.ID) AS LatePunches
        FROM (
          SELECT p.ID
          FROM project.Punch_data p
          WHERE CAST(p.PunchDateTime AS TIME) > '10:15:00'
          GROUP BY p.ID, FORMAT(p.PunchDateTime, 'yyyy-MM')
        ) AS LatePunchSubquery
        JOIN project.employeedetails e ON LatePunchSubquery.ID = e.CPF_NO
        WHERE e.LEVEL LIKE 'E_%'
        GROUP BY e.LEVEL
        ORDER BY e.LEVEL DESC;
      `;
      const requestLevelWiseLatePunches = pool2.request();
      // requestLevelWiseLatePunches.input('monthFilter', sql.VarChar, monthFilter);
      // requestLevelWiseLatePunches.input('locationFilter', sql.VarChar, locationFilter);
      const levelWiseLatePunchesResult =
        await requestLevelWiseLatePunches.query(levelWiseLatePunchesQuery);

      // Query for summarized late punches
      const sumLevelWiseLatePunchesQuery = `
        SELECT 
          CASE 
            WHEN LatePunchSubquery.LEVEL LIKE 'E%' THEN 'E% Levels'
            ELSE 'Other Levels'
          END AS EmployeeLevelCategory,
          COUNT(DISTINCT LatePunchSubquery.ID) AS LatePunches
        FROM (
          SELECT p.ID, e.LEVEL
          FROM project.Punch_data p 
          JOIN project.employeedetails e ON p.ID = e.CPF_NO
          WHERE CAST(p.PunchDateTime AS TIME) > '10:15:00'
          GROUP BY p.ID, e.LEVEL
        ) AS LatePunchSubquery
        GROUP BY 
          CASE 
            WHEN LatePunchSubquery.LEVEL LIKE 'E%' THEN 'E% Levels'
            ELSE 'Other Levels'
          END
        ORDER BY EmployeeLevelCategory DESC;
      `;
      const requestSumLevelWiseLatePunches = pool2.request();
      // requestSumLevelWiseLatePunches.input('monthFilter', sql.VarChar, monthFilter);
      // requestSumLevelWiseLatePunches.input('locationFilter', sql.VarChar, locationFilter);
      const sumLevelWiseLatePunchesResult =
        await requestSumLevelWiseLatePunches.query(
          sumLevelWiseLatePunchesQuery
        );

      // Query for overall statistics summary
      const summaryQuery = `
        DECLARE @workingDays INT;
        SET @workingDays = (
          SELECT COUNT(DISTINCT FORMAT(PunchDateTime, 'yyyy-MM-dd'))
          FROM project.Punch_data
        );
    
        DECLARE @totalEmployees INT;
        SET @totalEmployees = (
          SELECT COUNT(DISTINCT e.CPF_NO)
          FROM project.employeedetails e
          JOIN project.Punch_data p ON e.CPF_NO = p.ID
        );
    
        DECLARE @latePunches10_00 INT;
        SET @latePunches10_00 = (
          SELECT COUNT(Distinct ID)
          FROM project.Punch_data p
          WHERE CAST(p.PunchDateTime AS TIME) > '10:00:00'
        );
    
        DECLARE @latePunches10_15 INT;
        SET @latePunches10_15 = (
          SELECT COUNT(distinct ID)
          FROM project.Punch_data p
          WHERE CAST(p.PunchDateTime AS TIME) > '10:15:00'
        );
    
        SELECT 
          @workingDays AS [No_of_Working_Days_in_the_Month],
          @totalEmployees AS [Total_Employees_in_the_Month],
          @latePunches10_00 AS [No_of_Times_beyond_10:00],
          @latePunches10_15 AS [No_of_Times_beyond_10:15];
      `;
      const requestSummary = pool2.request();
      const summaryResult = await requestSummary.query(summaryQuery);
      console.log(summaryResult);

      await pool2.close(); // Close pool2 after fetching data

      // Combine the results based on employee ID
      const combinedResults = employeeResult.recordset.map((employee) => {
        const punchData =
          punchDataResult.recordset.find(
            (p) => p.Employee_ID == employee.employee_id
          ) || {};
        const leaveData =
          leaveDaysResult.recordset.find(
            (l) => l.Employee_ID == employee.employee_id
          ) || {};
        const tourData =
          tourDaysResult.recordset.find(
            (t) => t.Employee_ID == employee.employee_id
          ) || {};
        const absenteeData =
          absenteesResult.recordset.find(
            (a) => a.Employee_ID == employee.employee_id
          ) || {};

        return {
          ...employee,
          NoOfDaysBeyond10: punchData.NoOfDaysBeyond10 || 0,
          TotalTimeDelayBeyond10: punchData.TotalTimeDelayBeyond10InSeconds
            ? formatTime(punchData.TotalTimeDelayBeyond10InSeconds)
            : "00:00:00",
          NoOfDaysBeyond1015: punchData.NoOfDaysBeyond1015 || 0,
          TotalTimeDelayBeyond1015: punchData.TotalTimeDelayBeyond1015InSeconds
            ? formatTime(punchData.TotalTimeDelayBeyond1015InSeconds)
            : "00:00:00",
          TotalEACSAbsentDays: absenteeData.AbsentDays || 0,
          TotalLeaveDays: leaveData.TotalTourDaysWithoutDuplication || 0,
          TotalDaysOnTour: tourData.TotalTourDaysWithoutDuplication || 0,
        };
      });
      const punchData = punchDataResult.recordset;
      const leaveDays = leaveDaysResult.recordset;
      const tourDays = tourDaysResult.recordset;

      const combinedData = punchData.map((punch) => {
        const employeeLeaveDays =
          leaveDays.find((l) => l.Employee_ID == punch.Employee_ID) || {};
        const employeeTourDays =
          tourDays.find((t) => t.Employee_ID == punch.Employee_ID) || {};
        return {
          ...punch,
          TotalLeaveDays: employeeLeaveDays.TotalLeaveDays || 0,
          TotalTourDays: employeeTourDays.TotalTourDays || 0,
        };
      });

      const latePunchesStatistics = {
        ">80%": { Beyond10: 0, Beyond1015: 0 },
        "70-80%": { Beyond10: 0, Beyond1015: 0 },
        "60-70%": { Beyond10: 0, Beyond1015: 0 },
        "50-60%": { Beyond10: 0, Beyond1015: 0 },
        "40-50%": { Beyond10: 0, Beyond1015: 0 },
        "30-40%": { Beyond10: 0, Beyond1015: 0 },
        "20-30%": { Beyond10: 0, Beyond1015: 0 },
        "<20%": { Beyond10: 0, Beyond1015: 0 },
      };

      const totalWorkingDays =
        summaryResult.recordset[0].No_of_Working_Days_in_the_Month;

      punchDataResult.recordset.forEach((record) => {
        const daysBeyond10Percent =
          (record.NoOfDaysBeyond10 / totalWorkingDays) * 100;
        const daysBeyond1015Percent =
          (record.NoOfDaysBeyond1015 / totalWorkingDays) * 100;

        const range = getRange(daysBeyond10Percent);
        if (range) {
          latePunchesStatistics[range].Beyond10++;
        }

        const range1015 = getRange(daysBeyond1015Percent);
        if (range1015) {
          latePunchesStatistics[range1015].Beyond1015++;
        }
      });

      function getRange(percent) {
        if (percent > 80) return ">80%";
        if (percent > 70) return "70-80%";
        if (percent > 60) return "60-70%";
        if (percent > 50) return "50-60%";
        if (percent > 40) return "40-50%";
        if (percent > 30) return "30-40%";
        if (percent > 20) return "20-30%";
        if (percent <= 20) return "<20%";
        return null;
      }

      const statistics = {
        levelWiseLatePunches: levelWiseLatePunchesResult.recordset,
        sumLevelWiseLatePunches: sumLevelWiseLatePunchesResult.recordset,
        sumlevelwiseofothers: sumLevelWiseLatePunchesResult.recordset[1],
        sumlevelwiseofE: sumLevelWiseLatePunchesResult.recordset[0],
        summary: summaryResult.recordset[0],
      };
      console.log(statistics, latePunchesStatistics);
      // Prepare Excel sheet using ExcelJS
      // Prepare Excel sheet using ExcelJS
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Monthly Report");

      // Employee Level Section
      worksheet.mergeCells("A1:A3");
      worksheet.getCell("A1").value = "Employee Level";
      worksheet.getCell("A1").font = {
        bold: true,
        color: { argb: "FFFFFF" },
        size: 13,
      };
      worksheet.getCell("A1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "A52A2A" },
      };
      worksheet.getCell("A1").alignment = {
        vertical: "middle",
        horizontal: "center",
      };

      worksheet.mergeCells("B1:B3");
      worksheet.getCell("B1").value = "Late Punches";
      worksheet.getCell("B1").font = {
        bold: true,
        color: { argb: "FFFFFF" },
        size: 13,
      };
      worksheet.getCell("B1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "A52A2A" },
      };
      worksheet.getCell("B1").alignment = {
        vertical: "middle",
        horizontal: "center",
      };

      const employeeLevels = [
        "E9",
        "E8",
        "E7",
        "E6",
        "E5",
        "E4",
        "E3",
        "E2",
        "E1",
        "E0",
        "Total Officers",
        "Staff",
      ];
      employeeLevels.forEach((level, index) => {
        const rowNumber = 4 + index;
        worksheet.getCell(`A${rowNumber}`).value = level;
        const latePunchesData = statistics.levelWiseLatePunches[index];
        if (latePunchesData) {
          worksheet.getCell(`B${rowNumber}`).value =
            latePunchesData.LatePunches;
        } else {
          worksheet.getCell(`B${rowNumber}`).value =
            statistics.sumLevelWiseLatePunches[index - 10].LatePunches; // or some default value
        }
      });

      // Late Punches Profile Section
      worksheet.mergeCells("C1:E1");
      worksheet.getCell("C1").value = "Late Punches Profile";
      worksheet.getCell("C1").font = {
        bold: true,
        color: { argb: "FFFFFF" },
        size: 15,
      };
      worksheet.getCell("C1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "556B2F" },
      };
      worksheet.getCell("C1").alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.mergeCells("C2:C3");
      worksheet.getCell("C2").value = "% of Days in Month";
      worksheet.getCell("C2").font = { color: { argb: "FFFF00" }, size: 9 };
      worksheet.mergeCells("D2:E2");
      worksheet.getCell("D2").value = "% Employees in Band";
      worksheet.getCell("D3").value = "Beyond 10:00";
      worksheet.getCell("E3").value = "Beyond 10:15";

      const bands = [
        ">80%",
        "70-80%",
        "60-70%",
        "50-60%",
        "40-50%",
        "30-40%",
        "20-30%",
        "<20%",
      ];
      bands.forEach((band, index) => {
        const rowNumber = 4 + index;
        worksheet.getCell(`C${rowNumber}`).value = band;
        const bandData = latePunchesStatistics[band];
        if (bandData) {
          worksheet.getCell(`D${rowNumber}`).value = bandData.Beyond10;
          worksheet.getCell(`E${rowNumber}`).value = bandData.Beyond1015;
        } else {
          console.error(`No data found for band ${band}`);
          worksheet.getCell(`D${rowNumber}`).value = 0; // or some default value
          worksheet.getCell(`E${rowNumber}`).value = 0; // or some default value
        }
      });

      // Summary Section
      worksheet.mergeCells("F1:I3");
      worksheet.getCell("F1").value = "Summary";
      worksheet.getCell("F1").font = {
        bold: true,
        color: { argb: "FFFFFF" },
        size: 15,
      };
      worksheet.getCell("F1").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "800000" },
      };
      worksheet.getCell("F1").alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.mergeCells("F4:G6");
      worksheet.getCell("F4").value = "No. of Working Days in the month:";
      worksheet.mergeCells("H4:I6");
      worksheet.getCell("H4").value =
        statistics.summary.No_of_Working_Days_in_the_Month;
      worksheet.mergeCells("F7:G9");
      worksheet.getCell("F7").value = "Total Employees in the month:";
      worksheet.mergeCells("H7:I9");
      worksheet.getCell("H7").value =
        statistics.summary.Total_Employees_in_the_Month;

      worksheet.mergeCells("F10:I11");
      worksheet.getCell("F10").value = "TOTAL LATE PUNCHES DURING THE MONTH";
      worksheet.getCell("F10").font = {
        bold: true,
        color: { argb: "FFFFFF" },
        size: 12,
      };
      worksheet.getCell("F10").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "800000" },
      };
      worksheet.getCell("F10").alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.mergeCells("F12:G12");
      worksheet.getCell("F12").value = "No. of Times beyond 10:00:";
      worksheet.mergeCells("H12:I12");
      worksheet.getCell("H12").value =
        statistics.summary["No_of_Times_beyond_10:00"];
      worksheet.mergeCells("F13:G13");
      worksheet.getCell("F13").value = "No. of Times beyond 10:15:";
      worksheet.mergeCells("H13:I13");
      worksheet.getCell("H13").value =
        statistics.summary["No_of_Times_beyond_10:00"];

      // Style cells with data
      worksheet.getColumn(1).width = 20;
      worksheet.getColumn(2).width = 15;
      worksheet.getColumn(3).width = 15;
      worksheet.getColumn(4).width = 15;
      worksheet.getColumn(5).width = 15;
      worksheet.getColumn(6).width = 15;
      worksheet.getColumn(7).width = 15;

      worksheet.getRows(1, 2, 3).forEach((row) => {
        row.font = { bold: true };
        row.alignment = { vertical: "middle", horizontal: "center" };
      });

      const tableStartRow = 18;

      // Define table headers
      const tableHeaders = [
        "Employee ID",
        "First Name",
        "Middle Name",
        "Last Name",
        "Designation",
        "Department",
        "Site Name",
        "No of Days Beyond 10:00",
        "Total Time Delay Beyond 10:00",
        "No of Days Beyond 10:15",
        "Total Time Delay Beyond 10:15",
        "Total EACS Absent Days",
        "Total Leave Days",
        "Total Days On Tour",
      ];

      // Add headers to the worksheet
      tableHeaders.forEach((header, index) => {
        const cell = worksheet.getCell(tableStartRow, index + 1); // Columns A, B, C, etc.
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "D3D3D3" }, // Light gray background
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      // Add data rows below headers
      const dataStartRow = tableStartRow + 1; // Row 19
      combinedResults.forEach((rowData, rowIndex) => {
        const currentRow = dataStartRow + rowIndex;
        worksheet.getCell(`A${currentRow}`).value = rowData.employee_id;
        worksheet.getCell(`B${currentRow}`).value = rowData.first_name;
        worksheet.getCell(`C${currentRow}`).value = rowData.middle_name;
        worksheet.getCell(`D${currentRow}`).value = rowData.last_name;
        worksheet.getCell(`E${currentRow}`).value =
          rowData.employee_designation_type_name;
        worksheet.getCell(`F${currentRow}`).value = rowData.department_name;
        worksheet.getCell(`G${currentRow}`).value = rowData.site_name;
        worksheet.getCell(`H${currentRow}`).value = rowData.NoOfDaysBeyond10;
        worksheet.getCell(`I${currentRow}`).value =
          rowData.TotalTimeDelayBeyond10;
        worksheet.getCell(`J${currentRow}`).value = rowData.NoOfDaysBeyond1015;
        worksheet.getCell(`K${currentRow}`).value =
          rowData.TotalTimeDelayBeyond1015;
        worksheet.getCell(`L${currentRow}`).value = rowData.TotalEACSAbsentDays;
        worksheet.getCell(`M${currentRow}`).value = rowData.TotalLeaveDays;
        worksheet.getCell(`N${currentRow}`).value = rowData.TotalDaysOnTour;

        // Optional: Format time delay cells
        worksheet.getCell(`I${currentRow}`).numFmt = "hh:mm:ss";
        worksheet.getCell(`K${currentRow}`).numFmt = "hh:mm:ss";
      });

      // Adjust column widths for better readability
      tableHeaders.forEach((header, index) => {
        worksheet.getColumn(index + 1).width = 20; // Adjust width as needed
      });

      // Send the Excel file to the client
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Monthly_Report.xlsx"
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Error generating Excel report:", error);
      res.status(500).send("Server error");
    }
  } else {
    res.redirect("/");
  }
});

module.exports = router;

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null || seconds === undefined) {
    return "00:00:00";
  }
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function calculatePercentageChange(absenteeTrends) {
  const percentageChange = [];
  for (let i = 1; i < absenteeTrends.length; i++) {
    const previous = absenteeTrends[i - 1].TotalAbsentees;
    const current = absenteeTrends[i].TotalAbsentees;
    const change = ((current - previous) / previous) * 100;
    percentageChange.push({
      Month: absenteeTrends[i].Month,
      PercentageChange: change,
    });
  }
  return percentageChange;
}

function formatDate(date) {
  return moment(date).format("ddd MMM DD YYYY");
}

module.exports = router;
