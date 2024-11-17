const express = require("express");
const mysql = require("mysql2");
const router = express.Router();
const moment = require("moment-timezone");
const bcrypt = require('bcrypt');
const session = require('express-session');
const XLSX = require('xlsx');
// Create a connection to the database
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Tanushk@2004",
  database: "project",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

connection.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err.stack);
    return;
  }
  console.log("Connected to the database as id " + connection.threadId);
});

router.get("/emp_master", (req, res) => {
  const location = req.query.location || ''; 

  const query = location
    ? "SELECT CPF_NO, NAME, DESIGNATION_TEXT, LEVEL, ORG_UNIT_TEXT, LOCATION FROM employeedetails WHERE LOCATION = ?"
    : "SELECT CPF_NO, NAME, DESIGNATION_TEXT, LEVEL, ORG_UNIT_TEXT, LOCATION FROM employeedetails";

  connection.query(query, [location], (err, results) => {
    if (err) {
      console.error(err);
      res.status(500).send(err.message);
      return;
    }

    // Get distinct locations for the filter dropdown
    connection.query("SELECT DISTINCT LOCATION FROM employeedetails", (err, locations) => {
      if (err) {
        console.error(err);
        res.status(500).send(err.message);
        return;
      }

      res.render("emp_master", {
        title: "Employee Master",
        employees: results,
        locations: locations,
        selectedLocation: location
      });
    });
  });
});

router.get("/punching", (req, res) => {
  if(req.session.user){
    const defaultTime1 = "10:00:00";
  const defaultTime2 = "10:15:00";
  let time1 = req.query.time1 || defaultTime1;
  let time2 = req.query.time2 || defaultTime2;

  const query = `
        SELECT
            p.ID,
            e.Name,
            e.ORG_UNIT_TEXT As Section,
            e.Level,
            DATE_FORMAT(p.PunchDateTime, '%a %b %d %Y %H:%i:%s') AS PunchDateTime,
            CASE
                WHEN TIME(p.PunchDateTime) > TIME(?) THEN 'YES'
                ELSE 'ON TIME'
            END AS IsLateAfterTime1,
            CASE
                WHEN TIME(p.PunchDateTime) > TIME(?) THEN
                    SEC_TO_TIME(TIMESTAMPDIFF(SECOND, TIME(?), TIME(p.PunchDateTime)))
                ELSE '0:00:00'
            END AS DelayedFromTime1,
            CASE
                WHEN TIME(p.PunchDateTime) > TIME(?) THEN 'YES'
                ELSE 'CAME BEFORE ${time2}'
            END AS IsLateAfterTime2,
            CASE
                WHEN TIME(p.PunchDateTime) > TIME(?) THEN
                    SEC_TO_TIME(TIMESTAMPDIFF(SECOND, TIME(?), TIME(p.PunchDateTime)))
                ELSE '0:00:00'
            END AS DelayedFromTime2,
            DAYOFWEEK(p.PunchDateTime)-1 AS DOWeek
        FROM Punch_data p
        JOIN employeedetails e ON p.ID = e.CPF_NO
    `;

  connection.query(
    query,
    [time1, time1, time1, time2, time2, time2],
    (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).send(err.message);
        return;
      }
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
      res.render("punching", {
        title: "Punching Data",
        data: results,
        time1: time1,
        time2: time2,
        lateAfterTime1Count,
        onTimeAfterTime1Count,
        lateAfterTime2Count,
        onTimeAfterTime2Count,
      });
    }
  );
  }
  else{
    res.redirect('/')
  }
});
router.get("/leaveinfo", (req, res) => {
  if (req.session.user) {
    const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

    const query = `
      SELECT l.PERNR, l.BEGDA, l.ENDDA,
        (DATEDIFF(l.ENDDA, l.BEGDA) + 1 
        - ((WEEK(l.ENDDA) - WEEK(l.BEGDA)) * 2)
        - (CASE WHEN DAYOFWEEK(l.BEGDA) = 1 THEN 1 ELSE 0 END)
        - (CASE WHEN DAYOFWEEK(l.ENDDA) = 7 THEN 1 ELSE 0 END)
        ) AS TotalTourDaysExcludingWeekends,
        e.name, e.level, e.org_unit_text as Section
      FROM leaveinfo l
      JOIN employeedetails e ON l.PERNR = e.CPF_NO;
    `;

    connection.query(query, (error, results) => {
      if (error) throw error;


      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT l.PERNR,
            (DATEDIFF(l.ENDDA, l.BEGDA) + 1
            - ((WEEK(l.ENDDA) - WEEK(l.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(l.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(l.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            l.BEGDA,
            l.ENDDA
          FROM leaveinfo l
        ) AS LeaveDays
        GROUP BY PERNR;
      `;

      connection.query(totalsQuery, (totalsError, totalsResults) => {
        if (totalsError) throw totalsError;

        const finalResults = results.map((row) => {
          const totalDays = totalsResults.find((t) => t.PERNR === row.PERNR);

          let holidayCount = 0;
          let holidayList = [];

          const begdaDate = new Date(row.BEGDA);
          begdaDate.setHours(0, 0, 0, 0);
          const enddaDate = new Date(row.ENDDA);
          enddaDate.setHours(0, 0, 0, 0);

          const holidayDates = holidays.map(holiday => {
            const date = new Date(holiday);
            date.setHours(0, 0, 0, 0);
            return date;
          });

          for (let d = new Date(begdaDate); d <= enddaDate; d.setDate(d.getDate() + 1)) {
            if (holidayDates.some(holiday => holiday.getTime() === d.getTime())) {
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
            Holiday: holidayList.length > 0 ? holidayList.join(', ') : null,
          };
        });

        res.render("leaveinfo", { title: "Leave Information", data: finalResults });
      });
    });
  } else {
    res.redirect('/');
  }
});


router.get("/tourinfo", (req, res) => {
  if (req.session.user) {
    const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

    const query = `
      SELECT t.PERNR, t.BEGDA, t.ENDDA,
        (DATEDIFF(t.ENDDA, t.BEGDA) + 1 
        - ((WEEK(t.ENDDA) - WEEK(t.BEGDA)) * 2)
        - (CASE WHEN DAYOFWEEK(t.BEGDA) = 1 THEN 1 ELSE 0 END)
        - (CASE WHEN DAYOFWEEK(t.ENDDA) = 7 THEN 1 ELSE 0 END)
        ) AS TotalTourDaysExcludingWeekends,
        e.name, e.level, e.org_unit_text as Section
      FROM TourTable t
      JOIN employeedetails e ON t.PERNR = e.CPF_NO;
    `;

    connection.query(query, (error, results) => {
      if (error) throw error;

      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT t.PERNR,
            (DATEDIFF(t.ENDDA, t.BEGDA) + 1
            - ((WEEK(t.ENDDA) - WEEK(t.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(t.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(t.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            t.BEGDA,
            t.ENDDA
          FROM tourtable t
        ) AS TourDays
        GROUP BY PERNR;
      `;

      connection.query(totalsQuery, (totalsError, totalsResults) => {
        if (totalsError) throw totalsError;

        const finalResults = results.map((row) => {
          const totalDays = totalsResults.find((t) => t.PERNR === row.PERNR);

          let holidayCount = 0;
          let holidayList = [];

          const begdaDate = new Date(row.BEGDA);
          begdaDate.setHours(0, 0, 0, 0);
          const enddaDate = new Date(row.ENDDA);
          enddaDate.setHours(0, 0, 0, 0);

          const holidayDates = holidays.map(holiday => {
            const date = new Date(holiday);
            date.setHours(0, 0, 0, 0);
            return date;
          });

          for (let d = new Date(begdaDate); d <= enddaDate; d.setDate(d.getDate() + 1)) {
            if (holidayDates.some(holiday => holiday.getTime() === d.getTime())) {
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
            Holiday: holidayList.length > 0 ? holidayList.join(', ') : null,
          };
        });

        res.render("tour", { title: "Tour Information", data: finalResults });
      });
    });
  } else {
    res.redirect('/');
  }
});

function formatDate(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}


// router.get('/', (req, res) => {
//   res.render('index');
// });

// router.get('/', (req, res) => {
//   // Define queries to get the necessary data
//   const latestMonthQuery = 'SELECT MAX(YearMonth) AS latestMonth FROM employeedetails';
//   const totalEmployeesQuery = `
//     SELECT COUNT(DISTINCT CPF_NO) AS total 
//     FROM employeedetails
//     WHERE YearMonth = ?
//   `;
//   const totalLocationsQuery = `
//     SELECT COUNT(DISTINCT LOCATION) AS total 
//     FROM employeedetails
//     WHERE YearMonth = ?
//   `;

//   // Execute the latest month query first
//   new Promise((resolve, reject) => {
//     connection.query(latestMonthQuery, (err, results) => {
//       if (err) return reject(err);
//       resolve(results[0].latestMonth);
//     });
//   })
//   .then(latestMonth => {
//     if (!latestMonth) throw new Error('No data available');

//     // Execute the total employees and total locations queries
//     return Promise.all([
//       new Promise((resolve, reject) => {
//         connection.query(totalEmployeesQuery, [latestMonth], (err, results) => {
//           if (err) return reject(err);
//           resolve(results[0].total);
//         });
//       }),
//       new Promise((resolve, reject) => {
//         connection.query(totalLocationsQuery, [latestMonth], (err, results) => {
//           if (err) return reject(err);
//           resolve(results[0].total);
//         });
//       })
//     ]);
//   })
//   .then(([totalEmployees, totalLocations]) => {
//     // Render the dashboard view with the summary data
//     res.render('index', {
//       title: 'Dashboard',
//       totalEmployees,
//       totalLocations
//     });
//   })
//   .catch(error => {
//     console.error('Error fetching summary data:', error);
//     res.status(500).send('Database Error');
//   });
// });

router.get('/', (req, res) => {
  const latestMonthQuery = 'SELECT MAX(YearMonth) AS latestMonth FROM employeedetails';
  const totalEmployeesQuery = `
    SELECT COUNT(DISTINCT CPF_NO) AS total 
    FROM employeedetails
    WHERE YearMonth = ?
  `;
  const totalLocationsQuery = `
    SELECT COUNT(DISTINCT LOCATION) AS total 
    FROM employeedetails
    WHERE YearMonth = ?
  `;
  const absenteeTrendsQuery = `
    SELECT 
      DATE_FORMAT(a.DATE, '%Y-%m') AS Month, 
      COUNT(*) AS TotalAbsentees
    FROM 
      ABSENTEES_EMP a
    GROUP BY 
      DATE_FORMAT(a.DATE, '%Y-%m')
    ORDER BY 
      Month
  `;

  connection.query(latestMonthQuery, (err, results) => {
    if (err) {
      console.error('Error fetching latest month:', err);
      return res.status(500).send('Database Error');
    }

    const latestMonth = results[0]?.latestMonth;
    if (!latestMonth) {
      console.error('No data available');
      return res.status(500).send('No data available');
    }

    const queries = [
      new Promise((resolve, reject) => {
        connection.query(totalEmployeesQuery, [latestMonth], (err, results) => {
          if (err) return reject(err);
          resolve(results[0]?.total);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(totalLocationsQuery, [latestMonth], (err, results) => {
          if (err) return reject(err);
          resolve(results[0]?.total);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(absenteeTrendsQuery, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      })
    ];

    Promise.all(queries)
      .then(([totalEmployees, totalLocations, absenteeTrends]) => {
        const absenteePercentageChange = calculatePercentageChange(absenteeTrends);
        console.log(absenteeTrends)
        res.render('index', {
          title: 'Dashboard',
          totalEmployees,
          totalLocations,
          absenteePercentageChange: JSON.stringify(absenteePercentageChange) // Pass as JSON string to the template
        });
      })
      .catch(error => {
        console.error('Error fetching summary data:', error);
        res.status(500).send('Database Error');
      });
  });
});

function calculatePercentageChange(absenteeTrends) {
  const percentageChange = [];
  for (let i = 1; i < absenteeTrends.length; i++) {
    const previous = absenteeTrends[i - 1].TotalAbsentees;
    const current = absenteeTrends[i].TotalAbsentees;
    const change = ((current - previous) / previous) * 100;
    percentageChange.push({
      Month: absenteeTrends[i].Month,
      PercentageChange: change
    });
  }
  return percentageChange;
}





function formatDate(date) {
  const d = new Date(date);
  let month = "" + (d.getMonth() + 1);
  let day = "" + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return [year, month, day].join("-");
}
router.post('/login', async (req, res) => {
  const { userid, password } = req.body;
  if (!userid || !password) {
      return res.status(400).send('Username and password are required');
  }
  connection.query(
      `SELECT * FROM users WHERE userid = ?`,
      [userid],
      async (error, results) => {
          if (error) {
              console.error('Error querying database:', error);
              return res.status(500).send('Error logging in');
          }
          if (results.length > 0) {
              const user = results[0];
              try {
                  const match = await bcrypt.compare(password, user.Password);
                  if (match) {
                      req.session.user = { id: user.UserID, username: user.Username };
                      req.session.save((err) => {
                        if (err) {
                          console.error('Error saving session:', err);
                          return res.status(500).send('Error logging in');
                        }
                        res.redirect('/');
                      });
                  } else {
                      res.status(401).send('Invalid username/email or password');
                  }
              } catch (compareError) {
                  console.error('Error comparing passwords:', compareError);
                  res.status(500).send('Error logging in');
              }
          } else {
              res.status(401).send('Invalid username/email or password');
          }
      }
  );
});


router.post('/signup', async (req, res) => {
  const {userid, username, email, password } = req.body;
  
  try {
      const hashedPassword = await bcrypt.hash(password, 10);
      connection.query(
          'INSERT INTO users (UserID,Username, Email, Password) VALUES (?, ?, ?,?)',
          [userid,username, email, hashedPassword],
          (error, results) => {
              if (error) {
                  console.error('Error inserting data into MySQL:', error);
                  res.status(500).send('Error signing up');
              } else {
                  res.redirect('/login')
              }
          }
      );
  } catch (error) {
      console.error('Error hashing password:', error);
      res.status(500).send('Error signing up');
  }
});
router.get('/leavereport', (req, res) => {
  if(req.session.user){
    const { location, record_date } = req.query;

    const locationQuery = `
      SELECT DISTINCT e.Location
      FROM attendance_sitewise_report a
      INNER JOIN employeedetails e ON a.Employee_ID = e.CPF_NO
      ORDER BY e.Location
    `;
  
    const dateQuery = `
      SELECT DISTINCT DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', -1), '(', 1), '%d/%m/%Y'), '%Y-%m-%d') AS record_date
      FROM attendance_sitewise_report a
      INNER JOIN employeedetails e ON a.Employee_ID = e.CPF_NO
      WHERE (? = '' OR e.Location = ?)
      ORDER BY record_date
    `;
  
    let dataQuery = `
      SELECT 
        a.Employee_ID,
        e.Name,
        e.Designation_TEXT,
        SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', 1), ' ', -1) AS punch_in_time,
        DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', -1), '(', 1), '%d/%m/%Y'), '%Y-%m-%d') AS Date,
        TIME_FORMAT(TIMEDIFF(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', 1), ' ', -1), '09:45:00'), '%H:%i:%s') AS LATEBY,
        e.Location
      FROM 
        attendance_sitewise_report a
      INNER JOIN 
        employeedetails e ON a.Employee_ID = e.CPF_NO
    `;
  
    const queryParams = [];
    if (location) {
      dataQuery += ' WHERE e.Location = ?';
      queryParams.push(location);
    }
    if (record_date) {
      dataQuery += location ? ' AND DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, \' \', -1), \'(\', 1), \'%d/%m/%Y\'), \'%Y-%m-%d\') = ?' : ' WHERE DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, \' \', -1), \'(\', 1), \'%d/%m/%Y\'), \'%Y-%m-%d\') = ?';
      queryParams.push(record_date);
    }
  
    connection.query(locationQuery, (locationErr, locationResults) => {
      if (locationErr) {
        console.error('Location Query Error:', locationErr);
        return res.status(500).send('Database Error');
      }
  
      connection.query(dateQuery, [location || '', location || ''], (dateErr, dateResults) => {
        if (dateErr) {
          console.error('Date Query Error:', dateErr);
          return res.status(500).send('Database Error');
        }
  
        // Execute the data query with location and optionally date filter
        connection.query(dataQuery, queryParams, (dataErr, dataResults) => {
          if (dataErr) {
            console.error('Data Query Error:', dataErr);
            return res.status(500).send('Database Error');
          }
  
          res.render('Daily_sitewise_attendance', {
            title: 'Employees Daily Attendance Summary Sitewise Report',
            data: dataResults,
            locations: locationResults,
            dates: dateResults,
            selectedLocation: location,
            selectedDate: record_date
          });
        });
      });
    });  
  }
  else{
    res.redirect('/')
  }
});

router.get('/monthlyreport', (req, res) => {
  if(req.session.user){
    const locationFilter = req.query.location || 'ALL LOCATIONS';  // Default to 'ALL LOCATIONS' if no location is provided
    
    // Query to get the latest month from Punch_data
    const latestMonthQuery = `
      SELECT DATE_FORMAT(MAX(PunchDateTime), '%Y-%m') AS LatestMonth
      FROM Punch_data
    `;

    // Query to get unique locations
    const locationsQuery = `
      SELECT DISTINCT LOCATION 
      FROM employeedetails
    `;

    // Query to get the number of employees for each month, considering the location filter
    const monthlyEmployeeCountQuery = `
      SELECT DATE_FORMAT(e.YearMonth, '%Y-%m') AS Month, COUNT(*) AS EmployeeCount
      FROM employeedetails e
      WHERE 
        ('${locationFilter}' = 'ALL LOCATIONS' OR e.LOCATION = ?) 
      GROUP BY DATE_FORMAT(e.YearMonth, '%Y-%m')
      ORDER BY Month
    `;

    // Execute the latest month query
    connection.query(latestMonthQuery, (latestMonthErr, latestMonthResults) => {
      if (latestMonthErr) {
        console.error('Latest Month Query Error:', latestMonthErr);
        return res.status(500).send('Database Error');
      }

      const latestMonth = latestMonthResults[0].LatestMonth;
      const monthFilter = req.query.month || latestMonth;  // Default to the latest month if no month is provided
          
      // Conditional clause for location filter
      const locationClause = locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`;

      // Query to get employee details based on location filter and month
      const employeeQuery = `
        SELECT 
          e.CPF_NO AS ID, 
          e.NAME AS Name, 
          e.DESIGNATION_TEXT AS Designation, 
          e.LEVEL AS Level, 
          e.ORG_UNIT_TEXT AS Section
        FROM 
          employeedetails e
        WHERE 
          DATE_FORMAT(e.YearMonth, '%Y-%m') = ? ${locationClause}
      `;
      // Query to get total working days in the month
    const totalWorkingDaysQuery = `
    SELECT COUNT(DISTINCT DATE(PunchDateTime)) AS TotalWorkingDays
    FROM Punch_data p
    JOIN project.employeedetails e ON p.ID = e.CPF_NO
    WHERE DATE_FORMAT(PunchDateTime, '%Y-%m') = ? ${locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`}
  `;

      // Query to aggregate punch data
      const punchDataQuery = `
        SELECT 
          p.ID AS Employee_ID,
          COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:00:00' THEN 1 END) AS NoOfDaysBeyond10,
          SEC_TO_TIME(SUM(CASE WHEN TIME(p.PunchDateTime) > '10:00:00' THEN TIME_TO_SEC(TIMEDIFF(TIME(p.PunchDateTime), '10:00:00')) ELSE 0 END)) AS TotalTimeDelayBeyond10,
          COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:15:00' THEN 1 END) AS NoOfDaysBeyond1015,
          SEC_TO_TIME(SUM(CASE WHEN TIME(p.PunchDateTime) > '10:15:00' THEN TIME_TO_SEC(TIMEDIFF(TIME(p.PunchDateTime), '10:15:00')) ELSE 0 END)) AS TotalTimeDelayBeyond1015
        FROM 
          Punch_data p
        JOIN 
          employeedetails e ON p.ID = e.CPF_NO
        WHERE 
          DATE_FORMAT(p.PunchDateTime, '%Y-%m') = ? ${locationClause}
        GROUP BY 
          p.ID
      `;

      // Query to get total leave days without duplication from leaveinfo
      const leaveDaysQuery = `
        SELECT 
          l.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT 
            li.PERNR,
            (DATEDIFF(li.ENDDA, li.BEGDA) + 1
            - ((WEEK(li.ENDDA) - WEEK(li.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(li.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(li.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM 
            leaveinfo li
          JOIN 
            employeedetails e ON li.PERNR = e.CPF_NO
          WHERE 
            DATE_FORMAT(li.ENDDA, '%Y-%m') = ? ${locationClause}
        ) AS l  
        GROUP BY 
          l.PERNR;
      `;

      // Query to get total days on tour from TourTable
      const tourDaysQuery = `
        SELECT 
          t.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT 
            tt.PERNR,
            (DATEDIFF(tt.ENDDA, tt.BEGDA) + 1
            - ((WEEK(tt.ENDDA) - WEEK(tt.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(tt.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(tt.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM 
            TourTable tt
          JOIN 
            employeedetails e ON tt.PERNR = e.CPF_NO
          WHERE 
            DATE_FORMAT(tt.ENDDA, '%Y-%m') = ? ${locationClause}
        ) AS t
        GROUP BY 
          t.PERNR
      `;

      // Query to get total EACS absent days from ABSENTEES_EMP
      const absenteesQuery = `
        SELECT 
          a.EMPLOYEE_ID, 
          COUNT(*) AS TotalEACSAbsentDays
        FROM 
          ABSENTEES_EMP a
        JOIN 
          employeedetails e ON a.EMPLOYEE_ID = e.CPF_NO
        WHERE 
          DATE_FORMAT(a.DATE, '%Y-%m') = ? ${locationClause}
        GROUP BY 
          a.EMPLOYEE_ID
      `;

      // Execute the locations query
      connection.query(locationsQuery, (locationsErr, locationsResults) => {
        if (locationsErr) {
          console.error('Locations Query Error:', locationsErr);
          return res.status(500).send('Database Error');
        }

        // Execute the monthly employee count query with location filter
        connection.query(monthlyEmployeeCountQuery, [locationFilter === 'ALL LOCATIONS' ? null : locationFilter], (monthlyEmployeeCountErr, monthlyEmployeeCountResults) => {
          if (monthlyEmployeeCountErr) {
            console.error('Monthly Employee Count Query Error:', monthlyEmployeeCountErr);
            return res.status(500).send('Database Error');
          }
          
          connection.query(totalWorkingDaysQuery, [monthFilter], (totalWorkingDaysErr, totalWorkingDaysResults) => {
            if (totalWorkingDaysErr) {
              console.error('Total Working Days Query Error:', totalWorkingDaysErr);
              return res.status(500).send('Database Error');
            }

            const totalWorkingDays = totalWorkingDaysResults[0].TotalWorkingDays;

            connection.query(punchDataQuery, [monthFilter], (punchDataErr, punchDataResults) => {
              if (punchDataErr) {
                console.error('Punch Data Query Error:', punchDataErr);
                return res.status(500).send('Database Error');
              }

              // Calculate statistics for each range
              const latePunchesStatistics = {
                '>80%': { Beyond10: 0, Beyond1015: 0 },
                '70-80%': { Beyond10: 0, Beyond1015: 0 },
                '60-70%': { Beyond10: 0, Beyond1015: 0 },
                '50-60%': { Beyond10: 0, Beyond1015: 0 },
                '40-50%': { Beyond10: 0, Beyond1015: 0 },
                '30-40%': { Beyond10: 0, Beyond1015: 0 },
                '20-30%': { Beyond10: 0, Beyond1015: 0 },
                '<20%': { Beyond10: 0, Beyond1015: 0 }
              };
              console.log(totalWorkingDays)

              punchDataResults.forEach((record) => {
                const daysBeyond10Percent = (record.NoOfDaysBeyond10 / totalWorkingDays) * 100;
                const daysBeyond1015Percent = (record.NoOfDaysBeyond1015 / totalWorkingDays) * 100;

                const range = getRange(daysBeyond10Percent);
                if (range) {
                  latePunchesStatistics[range].Beyond10++;
                }

                const range1015 = getRange(daysBeyond1015Percent);
                if (range1015) {
                  latePunchesStatistics[range1015].Beyond1015++;
                }
              });

              // Helper function to determine the range
              function getRange(percent) {
                if (percent > 80) return '>80%';
                if (percent > 70) return '70-80%';
                if (percent > 60) return '60-70%';
                if (percent > 50) return '50-60%';
                if (percent > 40) return '40-50%';
                if (percent > 30) return '30-40%';
                if (percent > 20) return '20-30%';
                return '<20%';
              }
              connection.query(employeeQuery, [monthFilter], (employeeErr, employeeResults) => {
                if (employeeErr) {
                  console.error('Employee Query Error:', employeeErr);
                  return res.status(500).send('Database Error');
                }
    
                // Execute the punch data aggregation query
                connection.query(punchDataQuery, [monthFilter], (punchDataErr, punchDataResults) => {
                  if (punchDataErr) {
                    console.error('Punch Data Query Error:', punchDataErr);
                    return res.status(500).send('Database Error');
                  }
    
                  // Execute the leave days query
                  connection.query(leaveDaysQuery, [monthFilter], (leaveDaysErr, leaveDaysResults) => {
                    if (leaveDaysErr) {
                      console.error('Leave Days Query Error:', leaveDaysErr);
                      return res.status(500).send('Database Error');
                    }
    
                    // Execute the tour days query
                    connection.query(tourDaysQuery, [monthFilter], (tourDaysErr, tourDaysResults) => {
                      if (tourDaysErr) {
                        console.error('Tour Days Query Error:', tourDaysErr);
                        return res.status(500).send('Database Error');
                      }
    
                      // Execute the absentees query
                      connection.query(absenteesQuery, [monthFilter], (absenteesErr, absenteesResults) => {
                        if (absenteesErr) {
                          console.error('Absentees Query Error:', absenteesErr);
                          return res.status(500).send('Database Error');
                        }
    
                        // Combine employee details with aggregated punch data, leave days, tour days, and absentees
                        const combinedResults = employeeResults.map(emp => {
                          const punchData = punchDataResults.find(pd => pd.Employee_ID === emp.ID);
                          const leaveData = leaveDaysResults.find(ld => ld.Employee_ID === emp.ID);
                          const tourData = tourDaysResults.find(td => td.Employee_ID === emp.ID);
                          const absenteeData = absenteesResults.find(ad => ad.EMPLOYEE_ID == emp.ID);
                          return {
                            ...emp,
                            NoOfDaysBeyond10: punchData ? punchData.NoOfDaysBeyond10 : 0,
                            TotalTimeDelayBeyond10: punchData ? punchData.TotalTimeDelayBeyond10 : '00:00:00',
                            NoOfDaysBeyond1015: punchData ? punchData.NoOfDaysBeyond1015 : 0,
                            TotalTimeDelayBeyond1015: punchData ? punchData.TotalTimeDelayBeyond1015 : '00:00:00',
                            TotalEACSAbsentDays: absenteeData ? absenteeData.TotalEACSAbsentDays : 0,
                            TotalLeaveDays: leaveData ? leaveData.TotalTourDaysWithoutDuplication : 0,
                            TotalDaysOnTour: tourData ? tourData.TotalTourDaysWithoutDuplication : 0
                          };
                        });
                        console.log(combinedResults.length)
                        // Calculate statistics
                        const statistics = {
                          totalEmployees: combinedResults.length,
                          totalPunches: punchDataResults.reduce((acc, item) => acc + item.NoOfDaysBeyond10 + item.NoOfDaysBeyond1015, 0),
                          totalLeaveDays: leaveDaysResults.reduce((acc, item) => acc + Number(item.TotalTourDaysWithoutDuplication), 0),
                          totalTourDays: tourDaysResults.reduce((acc, item) => acc + Number(item.TotalTourDaysWithoutDuplication), 0),
                          totalEACSAbsentDays: absenteesResults.reduce((acc, item) => acc + item.TotalEACSAbsentDays, 0)
                        };
                        console.log(absenteesResults.length,latePunchesStatistics)
    
                        // Render the view with the monthly data
                        res.render('monthlyreport', {
                          title: 'Monthly Attendance Report',
                          statistics: statistics,
                          data: combinedResults,
                          selectedLocation: locationFilter,
                          latePunchesStatistics: latePunchesStatistics,
                          locations: locationsResults, // Pass locations to the view
                          selectedMonth: monthFilter, // Pass selected month to the view
                          monthlyEmployeeCounts: monthlyEmployeeCountResults // Pass monthly employee counts to the view
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  } else {
    res.redirect('/');
  }
});

// router.get('/monthlyreport', (req, res) => {
//   if (req.session.user) {
//     const locationFilter = req.query.location || 'ALL LOCATIONS';  // Default to 'ALL LOCATIONS' if no location is provided
    
//     // Query to get the latest month from Punch_data
//     const latestMonthQuery = `
//       SELECT DATE_FORMAT(MAX(PunchDateTime), '%Y-%m') AS LatestMonth
//       FROM Punch_data
//     `;

//     // Query to get unique locations
//     const locationsQuery = `
//       SELECT DISTINCT LOCATION 
//       FROM employeedetails
//     `;

//     // Query to get the number of employees for each month, considering the location filter
//     const monthlyEmployeeCountQuery = `
//       SELECT DATE_FORMAT(e.YearMonth, '%Y-%m') AS Month, COUNT(*) AS EmployeeCount
//       FROM employeedetails e
//       WHERE 
//         ('${locationFilter}' = 'ALL LOCATIONS' OR e.LOCATION = ?) 
//       GROUP BY DATE_FORMAT(e.YearMonth, '%Y-%m')
//       ORDER BY Month
//     `;

//     // Query to get total working days in the month
//     const totalWorkingDaysQuery = `
//       SELECT COUNT(DISTINCT DATE(PunchDateTime)) AS TotalWorkingDays
//       FROM Punch_data
//       WHERE DATE_FORMAT(PunchDateTime, '%Y-%m') = ? ${locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`}
//     `;

//     // Query to aggregate punch data for late arrival statistics
//     const punchDataQuery = `
//       SELECT 
//         p.ID AS Employee_ID,
//         COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:00:00' THEN 1 END) AS NoOfDaysBeyond10,
//         COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:15:00' THEN 1 END) AS NoOfDaysBeyond1015
//       FROM 
//         Punch_data p
//       JOIN 
//         employeedetails e ON p.ID = e.CPF_NO
//       WHERE 
//         DATE_FORMAT(p.PunchDateTime, '%Y-%m') = ? ${locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`}
//       GROUP BY 
//         p.ID
//     `;

//     // Query to get employee details based on location filter and month
//     const employeeQuery = `
//       SELECT 
//         e.CPF_NO AS ID, 
//         e.NAME AS Name, 
//         e.DESIGNATION_TEXT AS Designation, 
//         e.LEVEL AS Level, 
//         e.ORG_UNIT_TEXT AS Section
//       FROM 
//         employeedetails e
//       WHERE 
//         DATE_FORMAT(e.YearMonth, '%Y-%m') = ? ${locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`}
//     `;

//     // Execute the latest month query
//     connection.query(latestMonthQuery, (latestMonthErr, latestMonthResults) => {
//       if (latestMonthErr) {
//         console.error('Latest Month Query Error:', latestMonthErr);
//         return res.status(500).send('Database Error');
//       }

//       const latestMonth = latestMonthResults[0].LatestMonth;
//       const monthFilter = req.query.month || latestMonth;  // Default to the latest month if no month is provided

//       // Execute all the queries
//       connection.query(locationsQuery, (locationsErr, locationsResults) => {
//         if (locationsErr) {
//           console.error('Locations Query Error:', locationsErr);
//           return res.status(500).send('Database Error');
//         }

//         connection.query(monthlyEmployeeCountQuery, [locationFilter === 'ALL LOCATIONS' ? null : locationFilter], (monthlyEmployeeCountErr, monthlyEmployeeCountResults) => {
//           if (monthlyEmployeeCountErr) {
//             console.error('Monthly Employee Count Query Error:', monthlyEmployeeCountErr);
//             return res.status(500).send('Database Error');
//           }

//           connection.query(totalWorkingDaysQuery, [monthFilter], (totalWorkingDaysErr, totalWorkingDaysResults) => {
//             if (totalWorkingDaysErr) {
//               console.error('Total Working Days Query Error:', totalWorkingDaysErr);
//               return res.status(500).send('Database Error');
//             }

//             const totalWorkingDays = totalWorkingDaysResults[0].TotalWorkingDays;

//             connection.query(punchDataQuery, [monthFilter], (punchDataErr, punchDataResults) => {
//               if (punchDataErr) {
//                 console.error('Punch Data Query Error:', punchDataErr);
//                 return res.status(500).send('Database Error');
//               }

//               // Calculate statistics for each range
//               const latePunchesStatistics = {
//                 '>80%': { Beyond10: 0, Beyond1015: 0 },
//                 '70-80%': { Beyond10: 0, Beyond1015: 0 },
//                 '60-70%': { Beyond10: 0, Beyond1015: 0 },
//                 '50-60%': { Beyond10: 0, Beyond1015: 0 },
//                 '40-50%': { Beyond10: 0, Beyond1015: 0 },
//                 '30-40%': { Beyond10: 0, Beyond1015: 0 },
//                 '20-30%': { Beyond10: 0, Beyond1015: 0 },
//                 '<20%': { Beyond10: 0, Beyond1015: 0 }
//               };

//               punchDataResults.forEach((record) => {
//                 const daysBeyond10Percent = (record.NoOfDaysBeyond10 / totalWorkingDays) * 100;
//                 const daysBeyond1015Percent = (record.NoOfDaysBeyond1015 / totalWorkingDays) * 100;

//                 const range = getRange(daysBeyond10Percent);
//                 if (range) {
//                   latePunchesStatistics[range].Beyond10++;
//                 }

//                 const range1015 = getRange(daysBeyond1015Percent);
//                 if (range1015) {
//                   latePunchesStatistics[range1015].Beyond1015++;
//                 }
//               });

//               // Helper function to determine the range
//               function getRange(percent) {
//                 if (percent > 80) return '>80%';
//                 if (percent > 70) return '70-80%';
//                 if (percent > 60) return '60-70%';
//                 if (percent > 50) return '50-60%';
//                 if (percent > 40) return '40-50%';
//                 if (percent > 30) return '30-40%';
//                 if (percent > 20) return '20-30%';
//                 return '<20%';
//               }

//               // Execute the employee details query
//               connection.query(employeeQuery, [monthFilter], (employeeErr, employeeResults) => {
//                 if (employeeErr) {
//                   console.error('Employee Query Error:', employeeErr);
//                   return res.status(500).send('Database Error');
//                 }

//                 // Combine employee details with aggregated punch data
//                 const combinedResults = employeeResults.map(emp => {
//                   const punchData = punchDataResults.find(pd => pd.Employee_ID === emp.ID);
//                   return {
//                     ...emp,
//                     NoOfDaysBeyond10: punchData ? punchData.NoOfDaysBeyond10 : 0,
//                     NoOfDaysBeyond1015: punchData ? punchData.NoOfDaysBeyond1015 : 0
//                   };
//                 });

//                 // Calculate additional statistics
//                 const statistics = {
//                   totalEmployees: combinedResults.length,
//                   totalPunches: punchDataResults.reduce((acc, item) => acc + item.NoOfDaysBeyond10 + item.NoOfDaysBeyond1015, 0),
//                   totalWorkingDays: totalWorkingDays
//                 };
//                 console.log(latePunchesStatistics)
//                 // Render the view with the monthly data
//                 res.render('monthlyreport', {
//                   title: 'Monthly Attendance Report',
//                   statistics: statistics,
//                   data: combinedResults,
//                   latePunchesStatistics: latePunchesStatistics,
//                   selectedLocation: locationFilter,
//                   locations: locationsResults, // Pass locations to the view
//                   selectedMonth: monthFilter, // Pass selected month to the view
//                   monthlyEmployeeCounts: monthlyEmployeeCountResults // Pass monthly employee counts to the view
//                 });
//               });
//             });
//           });
//         });
//       });
//     });
//   } else {
//     res.redirect('/');
//   }
// });



const ExcelJS = require('exceljs');

router.get('/download/monthlyreport', (req, res) => {
  if(req.session.user){
    const locationFilter = req.query.location || 'ALL LOCATIONS';  // Default to 'ALL LOCATIONS' if no location is provided
    
    // Query to get the latest month from Punch_data
    const latestMonthQuery = `
      SELECT DATE_FORMAT(MAX(PunchDateTime), '%Y-%m') AS LatestMonth
      FROM Punch_data
    `;

    // Query to get unique locations
    const locationsQuery = `
      SELECT DISTINCT LOCATION 
      FROM employeedetails
    `;

    // Query to get the number of employees for each month, considering the location filter
    const monthlyEmployeeCountQuery = `
      SELECT DATE_FORMAT(e.YearMonth, '%Y-%m') AS Month, COUNT(*) AS EmployeeCount
      FROM employeedetails e
      WHERE 
        ('${locationFilter}' = 'ALL LOCATIONS' OR e.LOCATION = ?) 
      GROUP BY DATE_FORMAT(e.YearMonth, '%Y-%m')
      ORDER BY Month
    `;

    // Execute the latest month query
    connection.query(latestMonthQuery, (latestMonthErr, latestMonthResults) => {
      if (latestMonthErr) {
        console.error('Latest Month Query Error:', latestMonthErr);
        return res.status(500).send('Database Error');
      }

      const latestMonth = latestMonthResults[0].LatestMonth;
      const monthFilter = req.query.month || latestMonth;  // Default to the latest month if no month is provided

      // Conditional clause for location filter
      const locationClause = locationFilter === 'ALL LOCATIONS' ? '' : `AND e.LOCATION = '${locationFilter}'`;

      // Query to get employee details based on location filter and month
      const employeeQuery = `
        SELECT 
          e.CPF_NO AS ID, 
          e.NAME AS Name, 
          e.DESIGNATION_TEXT AS Designation, 
          e.LEVEL AS Level, 
          e.ORG_UNIT_TEXT AS Section
        FROM 
          employeedetails e
        WHERE 
          DATE_FORMAT(e.YearMonth, '%Y-%m') = ? ${locationClause}
      `;

      // Query to aggregate punch data
      const punchDataQuery = `
        SELECT 
          p.ID AS Employee_ID,
          COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:00:00' THEN 1 END) AS NoOfDaysBeyond10,
          SEC_TO_TIME(SUM(CASE WHEN TIME(p.PunchDateTime) > '10:00:00' THEN TIME_TO_SEC(TIMEDIFF(TIME(p.PunchDateTime), '10:00:00')) ELSE 0 END)) AS TotalTimeDelayBeyond10,
          COUNT(CASE WHEN TIME(p.PunchDateTime) > '10:15:00' THEN 1 END) AS NoOfDaysBeyond1015,
          SEC_TO_TIME(SUM(CASE WHEN TIME(p.PunchDateTime) > '10:15:00' THEN TIME_TO_SEC(TIMEDIFF(TIME(p.PunchDateTime), '10:15:00')) ELSE 0 END)) AS TotalTimeDelayBeyond1015
        FROM 
          Punch_data p
        JOIN 
          employeedetails e ON p.ID = e.CPF_NO
        WHERE 
          DATE_FORMAT(p.PunchDateTime, '%Y-%m') = ? ${locationClause}
        GROUP BY 
          p.ID
      `;

      // Query to get total leave days without duplication from leaveinfo
      const leaveDaysQuery = `
        SELECT 
          l.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT 
            li.PERNR,
            (DATEDIFF(li.ENDDA, li.BEGDA) + 1
            - ((WEEK(li.ENDDA) - WEEK(li.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(li.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(li.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM 
            leaveinfo li
          JOIN 
            employeedetails e ON li.PERNR = e.CPF_NO
          WHERE 
            DATE_FORMAT(li.ENDDA, '%Y-%m') = ? ${locationClause}
        ) AS l  
        GROUP BY 
          l.PERNR;
      `;

      // Query to get total days on tour from TourTable
      const tourDaysQuery = `
        SELECT 
          t.PERNR AS Employee_ID, 
          SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT 
            tt.PERNR,
            (DATEDIFF(tt.ENDDA, tt.BEGDA) + 1
            - ((WEEK(tt.ENDDA) - WEEK(tt.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(tt.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(tt.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends
          FROM 
            TourTable tt
          JOIN 
            employeedetails e ON tt.PERNR = e.CPF_NO
          WHERE 
            DATE_FORMAT(tt.ENDDA, '%Y-%m') = ? ${locationClause}
        ) AS t
        GROUP BY 
          t.PERNR
      `;

      // Query to get total EACS absent days from ABSENTEES_EMP
      const absenteesQuery = `
        SELECT 
          a.EMPLOYEE_ID, 
          COUNT(*) AS TotalEACSAbsentDays
        FROM 
          ABSENTEES_EMP a
        JOIN 
          employeedetails e ON a.EMPLOYEE_ID = e.CPF_NO
        WHERE 
          DATE_FORMAT(a.DATE, '%Y-%m') = ? ${locationClause}
        GROUP BY 
          a.EMPLOYEE_ID
      `;

      // Execute the locations query
      connection.query(locationsQuery, (locationsErr, locationsResults) => {
        if (locationsErr) {
          console.error('Locations Query Error:', locationsErr);
          return res.status(500).send('Database Error');
        }

        // Execute the monthly employee count query with location filter
        connection.query(monthlyEmployeeCountQuery, [locationFilter === 'ALL LOCATIONS' ? null : locationFilter], (monthlyEmployeeCountErr, monthlyEmployeeCountResults) => {
          if (monthlyEmployeeCountErr) {
            console.error('Monthly Employee Count Query Error:', monthlyEmployeeCountErr);
            return res.status(500).send('Database Error');
          }

          // Execute the employee details query with location filter and month
          connection.query(employeeQuery, [monthFilter], (employeeErr, employeeResults) => {
            if (employeeErr) {
              console.error('Employee Query Error:', employeeErr);
              return res.status(500).send('Database Error');
            }

            // Execute the punch data aggregation query
            connection.query(punchDataQuery, [monthFilter], (punchDataErr, punchDataResults) => {
              if (punchDataErr) {
                console.error('Punch Data Query Error:', punchDataErr);
                return res.status(500).send('Database Error');
              }

              // Execute the leave days query
              connection.query(leaveDaysQuery, [monthFilter], (leaveDaysErr, leaveDaysResults) => {
                if (leaveDaysErr) {
                  console.error('Leave Days Query Error:', leaveDaysErr);
                  return res.status(500).send('Database Error');
                }

                // Execute the tour days query
                connection.query(tourDaysQuery, [monthFilter], (tourDaysErr, tourDaysResults) => {
                  if (tourDaysErr) {
                    console.error('Tour Days Query Error:', tourDaysErr);
                    return res.status(500).send('Database Error');
                  }

                  // Execute the absentees query
                  connection.query(absenteesQuery, [monthFilter], (absenteesErr, absenteesResults) => {
                    if (absenteesErr) {
                      console.error('Absentees Query Error:', absenteesErr);
                      return res.status(500).send('Database Error');
                    }

                    // Combine employee details with aggregated punch data, leave days, tour days, and absentees
                    const combinedResults = employeeResults.map(emp => {
                      const punchData = punchDataResults.find(pd => pd.Employee_ID === emp.ID);
                      const leaveData = leaveDaysResults.find(ld => ld.Employee_ID === emp.ID);
                      const tourData = tourDaysResults.find(td => td.Employee_ID === emp.ID);
                      const absenteeData = absenteesResults.find(ad => ad.EMPLOYEE_ID == emp.ID);
                      return {
                        ...emp,
                        NoOfDaysBeyond10: punchData ? punchData.NoOfDaysBeyond10 : 0,
                        TotalTimeDelayBeyond10: punchData ? punchData.TotalTimeDelayBeyond10 : '00:00:00',
                        NoOfDaysBeyond1015: punchData ? punchData.NoOfDaysBeyond1015 : 0,
                        TotalTimeDelayBeyond1015: punchData ? punchData.TotalTimeDelayBeyond1015 : '00:00:00',
                        TotalEACSAbsentDays: absenteeData ? absenteeData.TotalEACSAbsentDays : 0,
                        TotalLeaveDays: leaveData ? leaveData.TotalTourDaysWithoutDuplication : 0,
                        TotalDaysOnTour: tourData ? tourData.TotalTourDaysWithoutDuplication : 0
                      };
                    });

                    // Create a new workbook and worksheet
                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet('Monthly Data');

                    // Define the columns for the worksheet
                    worksheet.columns = [
                      { header: 'ID', key: 'ID', width: 10 },
                      { header: 'Name', key: 'Name', width: 30 },
                      { header: 'Designation', key: 'Designation', width: 30 },
                      { header: 'Level', key: 'Level', width: 10 },
                      { header: 'Section', key: 'Section', width: 30 },
                      { header: 'NoOfDaysBeyond10', key: 'NoOfDaysBeyond10', width: 20 },
                      { header: 'TotalTimeDelayBeyond10', key: 'TotalTimeDelayBeyond10', width: 25 },
                      { header: 'NoOfDaysBeyond1015', key: 'NoOfDaysBeyond1015', width: 20 },
                      { header: 'TotalTimeDelayBeyond1015', key: 'TotalTimeDelayBeyond1015', width: 25 },
                      { header: 'TotalEACSAbsentDays', key: 'TotalEACSAbsentDays', width: 20 },
                      { header: 'TotalLeaveDays', key: 'TotalLeaveDays', width: 20 },
                      { header: 'TotalDaysOnTour', key: 'TotalDaysOnTour', width: 20 }
                    ];

                    // Add rows to the worksheet
                    combinedResults.forEach(emp => {
                      worksheet.addRow(emp);
                    });

                    // Write the workbook to a buffer and send it as a response
                    workbook.xlsx.writeBuffer().then(buffer => {
                      res.setHeader('Content-Disposition', 'attachment; filename=Monthly_Data.xlsx');
                      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                      res.send(buffer);
                    }).catch(err => {
                      console.error('ExcelJS Error:', err);
                      res.status(500).send('Error generating Excel file');
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  } else {
    res.redirect('/');
  }
});


router.get('/download/punching', (req, res) => {
  if (req.session.user) {
    const defaultTime1 = "10:00:00";
    const defaultTime2 = "10:15:00";
    let time1 = req.query.time1 || defaultTime1;
    let time2 = req.query.time2 || defaultTime2;

    const query = `
      SELECT
        p.ID,
        e.Name,
        e.ORG_UNIT_TEXT As Section,
        e.Level,
        DATE_FORMAT(p.PunchDateTime, '%a %b %d %Y %H:%i:%s') AS PunchDateTime,
        CASE
          WHEN TIME(p.PunchDateTime) > TIME(?) THEN 'YES'
          ELSE 'ON TIME'
        END AS IsLateAfterTime1,
        CASE
          WHEN TIME(p.PunchDateTime) > TIME(?) THEN
            SEC_TO_TIME(TIMESTAMPDIFF(SECOND, TIME(?), TIME(p.PunchDateTime)))
          ELSE '0:00:00'
        END AS DelayedFromTime1,
        CASE
          WHEN TIME(p.PunchDateTime) > TIME(?) THEN 'YES'
          ELSE 'CAME BEFORE ${time2}'
        END AS IsLateAfterTime2,
        CASE
          WHEN TIME(p.PunchDateTime) > TIME(?) THEN
            SEC_TO_TIME(TIMESTAMPDIFF(SECOND, TIME(?), TIME(p.PunchDateTime)))
          ELSE '0:00:00'
        END AS DelayedFromTime2,
        DAYOFWEEK(p.PunchDateTime)-1 AS DOWeek
      FROM Punch_data p
      JOIN employeedetails e ON p.ID = e.CPF_NO
    `;

    connection.query(
      query,
      [time1, time1, time1, time2, time2, time2],
      (err, results) => {
        if (err) {
          console.error(err);
          res.status(500).send(err.message);
          return;
        }

        // Create a new workbook and add a worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(results);

        XLSX.utils.book_append_sheet(wb, ws, 'Punching Data');

        // Write the workbook to a buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send the buffer as an Excel file
        res.setHeader('Content-Disposition', 'attachment; filename="punching_data.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
      }
    );
  } else {
    res.redirect('/');
  }
});
router.get('/download/leaveinfo', (req, res) => {
  if (req.session.user) {
    const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

    const query = `
      SELECT l.PERNR, l.BEGDA, l.ENDDA,
        (DATEDIFF(l.ENDDA, l.BEGDA) + 1 
        - ((WEEK(l.ENDDA) - WEEK(l.BEGDA)) * 2)
        - (CASE WHEN DAYOFWEEK(l.BEGDA) = 1 THEN 1 ELSE 0 END)
        - (CASE WHEN DAYOFWEEK(l.ENDDA) = 7 THEN 1 ELSE 0 END)
        ) AS TotalTourDaysExcludingWeekends,
        e.name, e.level, e.org_unit_text as Section
      FROM leaveinfo l
      JOIN employeedetails e ON l.PERNR = e.CPF_NO;
    `;

    connection.query(query, (error, results) => {
      if (error) throw error;

      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT l.PERNR,
            (DATEDIFF(l.ENDDA, l.BEGDA) + 1
            - ((WEEK(l.ENDDA) - WEEK(l.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(l.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(l.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            l.BEGDA,
            l.ENDDA
          FROM leaveinfo l
        ) AS LeaveDays
        GROUP BY PERNR;
      `;

      connection.query(totalsQuery, (totalsError, totalsResults) => {
        if (totalsError) throw totalsError;

        const finalResults = results.map((row) => {
          const totalDays = totalsResults.find((t) => t.PERNR === row.PERNR);

          let holidayCount = 0;
          let holidayList = [];

          const begdaDate = new Date(row.BEGDA);
          begdaDate.setHours(0, 0, 0, 0);
          const enddaDate = new Date(row.ENDDA);
          enddaDate.setHours(0, 0, 0, 0);

          const holidayDates = holidays.map(holiday => {
            const date = new Date(holiday);
            date.setHours(0, 0, 0, 0);
            return date;
          });

          for (let d = new Date(begdaDate); d <= enddaDate; d.setDate(d.getDate() + 1)) {
            if (holidayDates.some(holiday => holiday.getTime() === d.getTime())) {
              holidayCount += 1;
              holidayList.push(formatDate(d));
            }
          }

          const adjustedTotalLeaveDays = totalDays
            ? totalDays.TotalTourDaysWithoutDuplication - holidayCount
            : 0;

          return {
            ...row,
            ENDDA: formatDate(row.ENDDA),
            BEGDA: formatDate(row.BEGDA),
            TotalTourDaysWithoutDuplication: adjustedTotalLeaveDays,
            Holiday: holidayList.length > 0 ? holidayList.join(', ') : null,
          };
        });

        // Create a new workbook and add a worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(finalResults);

        XLSX.utils.book_append_sheet(wb, ws, 'Leave Information');

        // Write the workbook to a buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send the buffer as an Excel file
        res.setHeader('Content-Disposition', 'attachment; filename="leave_information.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
      });
    });
  } else {
    res.redirect('/');
  }
});

router.get("/download/tourinfo", (req, res) => {
  if (req.session.user) {
    const holidays = req.query.holidays ? req.query.holidays.split(",") : [];

    const query = `
      SELECT t.PERNR, t.BEGDA, t.ENDDA,
        (DATEDIFF(t.ENDDA, t.BEGDA) + 1 
        - ((WEEK(t.ENDDA) - WEEK(t.BEGDA)) * 2)
        - (CASE WHEN DAYOFWEEK(t.BEGDA) = 1 THEN 1 ELSE 0 END)
        - (CASE WHEN DAYOFWEEK(t.ENDDA) = 7 THEN 1 ELSE 0 END)
        ) AS TotalTourDaysExcludingWeekends,
        e.name, e.level, e.org_unit_text as Section
      FROM TourTable t
      JOIN employeedetails e ON t.PERNR = e.CPF_NO;
    `;

    connection.query(query, (error, results) => {
      if (error) throw error;

      const totalsQuery = `
        SELECT PERNR, SUM(TotalTourDaysExcludingWeekends) AS TotalTourDaysWithoutDuplication
        FROM (
          SELECT t.PERNR,
            (DATEDIFF(t.ENDDA, t.BEGDA) + 1
            - ((WEEK(t.ENDDA) - WEEK(t.BEGDA)) * 2)
            - (CASE WHEN DAYOFWEEK(t.BEGDA) = 1 THEN 1 ELSE 0 END)
            - (CASE WHEN DAYOFWEEK(t.ENDDA) = 7 THEN 1 ELSE 0 END)
            ) AS TotalTourDaysExcludingWeekends,
            t.BEGDA,
            t.ENDDA
          FROM tourtable t
        ) AS TourDays
        GROUP BY PERNR;
      `;

      connection.query(totalsQuery, (totalsError, totalsResults) => {
        if (totalsError) throw totalsError;

        const finalResults = results.map((row) => {
          const totalDays = totalsResults.find((t) => t.PERNR === row.PERNR);

          let holidayCount = 0;
          let holidayList = [];

          const begdaDate = new Date(row.BEGDA);
          begdaDate.setHours(0, 0, 0, 0);
          const enddaDate = new Date(row.ENDDA);
          enddaDate.setHours(0, 0, 0, 0);

          const holidayDates = holidays.map(holiday => {
            const date = new Date(holiday);
            date.setHours(0, 0, 0, 0);
            return date;
          });

          for (let d = new Date(begdaDate); d <= enddaDate; d.setDate(d.getDate() + 1)) {
            if (holidayDates.some(holiday => holiday.getTime() === d.getTime())) {
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
            Holiday: holidayList.length > 0 ? holidayList.join(', ') : null,
          };
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(finalResults);

        XLSX.utils.book_append_sheet(wb, ws, 'Tour Information');

        // Write the workbook to a buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send the buffer as an Excel file
        res.setHeader('Content-Disposition', 'attachment; filename="Tour_information.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
      });
    });
  } else {
    res.redirect('/');
  }
});
router.get('/download/leavereport', (req, res) => {
  if(req.session.user){
    const { location, record_date } = req.query;

    const locationQuery = `
      SELECT DISTINCT e.Location
      FROM attendance_sitewise_report a
      INNER JOIN employeedetails e ON a.Employee_ID = e.CPF_NO
      ORDER BY e.Location
    `;
  
    const dateQuery = `
      SELECT DISTINCT DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', -1), '(', 1), '%d/%m/%Y'), '%Y-%m-%d') AS record_date
      FROM attendance_sitewise_report a
      INNER JOIN employeedetails e ON a.Employee_ID = e.CPF_NO
      WHERE (? = '' OR e.Location = ?)
      ORDER BY record_date
    `;
  
    let dataQuery = `
      SELECT 
        a.Employee_ID,
        e.Name,
        e.Designation_TEXT,
        SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', 1), ' ', -1) AS punch_in_time,
        DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', -1), '(', 1), '%d/%m/%Y'), '%Y-%m-%d') AS Date,
        TIME_FORMAT(TIMEDIFF(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, ' ', 1), ' ', -1), '09:45:00'), '%H:%i:%s') AS LATEBY,
        e.Location
      FROM 
        attendance_sitewise_report a
      INNER JOIN 
        employeedetails e ON a.Employee_ID = e.CPF_NO
    `;
  
    const queryParams = [];
    if (location) {
      dataQuery += ' WHERE e.Location = ?';
      queryParams.push(location);
    }
    if (record_date) {
      dataQuery += location ? ' AND DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, \' \', -1), \'(\', 1), \'%d/%m/%Y\'), \'%Y-%m-%d\') = ?' : ' WHERE DATE_FORMAT(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(a.punching_time, \' \', -1), \'(\', 1), \'%d/%m/%Y\'), \'%Y-%m-%d\') = ?';
      queryParams.push(record_date);
    }
  
    connection.query(locationQuery, (locationErr, locationResults) => {
      if (locationErr) {
        console.error('Location Query Error:', locationErr);
        return res.status(500).send('Database Error');
      }
  
      connection.query(dateQuery, [location || '', location || ''], (dateErr, dateResults) => {
        if (dateErr) {
          console.error('Date Query Error:', dateErr);
          return res.status(500).send('Database Error');
        }
  
        // Execute the data query with location and optionally date filter
        connection.query(dataQuery, queryParams, (dataErr, dataResults) => {
          if (dataErr) {
            console.error('Data Query Error:', dataErr);
            return res.status(500).send('Database Error');
          }
  
          const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(dataResults);

        XLSX.utils.book_append_sheet(wb, ws, 'Sitewise Leave Information');

        // Write the workbook to a buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send the buffer as an Excel file
        res.setHeader('Content-Disposition', 'attachment; filename="Sitewise_Leave_information.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
        });
      });
    });  
  }
  else{
    res.redirect('/')
  }
});



module.exports = router;
