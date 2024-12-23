const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const WMIClient = require('wmi-client');  // WMI query module
const os = require('os');
const wmi = require('node-wmi'); // Ensure this is correctly imported
const csvParser = require('csv-parser');
const fs = require('fs');
const moment = require('moment');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();  

  // Fetch the software details using WMI query and send data to renderer
  fetchOfficeScanSoftware(); // To find anti virus info
  fetchSoftwareInfo();       // To get running software info
  getLatestHotfix();
  fetchAntivirusDetails();
  fetchRunningAntivirusProcesses();
}

app.whenReady().then(() => {
  createWindow();

  setInterval(() => {
    fetchRunningAntivirusProcesses();
  }, 10000);

  setInterval(() => {
    fetchOfficeScanSoftware();
  }, 300000);

  ipcMain.on('fetch-running-antivirus', () => {
    fetchRunningAntivirusProcesses();
  });
  

  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().map(cpu => cpu.model).join(', '),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    hostname: os.hostname(),
    release: os.release(),
    type: os.type(),
    uptime: os.uptime(),
    networkInterfaces: getNetworkInfo(),
    patches: getPatches()  // patches now holds a Promise
  };

  systemInfo.patches.then(patches => {
    systemInfo.patches = patches;

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('system-info', systemInfo);
    });
  }).catch(error => {
    console.error("Error fetching system info:", error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});




function getLatestHotfix() {
  exec('wmic qfe get HotFixID /format:csv', (error, stdout, stderr) => {
    if (error || stderr) {
      const errorMessage = `Error fetching hotfix ID: ${error || stderr}`;
      
      return;
    }

    const lines = stdout.trim().split('\n');
    const hotfixes = lines.slice(1).map(line => line.split(',').pop().trim());
    let latestHotfix = hotfixes.pop();

    if (latestHotfix) {
      latestHotfix = latestHotfix.replace('KB', ''); // Trim "KB" from Hotfix ID
      console.log(`Latest Hotfix ID (trimmed): ${latestHotfix}`);
      
      fetchReleaseDateFromCSV(latestHotfix);
    } else {
      console.log('No hotfixes found.');
      
    }
  });
}

// Fetch release date from the CSV file
function fetchReleaseDateFromCSV(hotfixID) {
  const csvFilePath = path.join(__dirname, 'patches.csv'); // Make sure the CSV file path is correct
  let patchFound = false;

  console.log('Reading CSV from:', csvFilePath); // Debug: Check the CSV file path

  // Create a readable stream for the CSV file
  const readStream = fs.createReadStream(csvFilePath)
    .pipe(csvParser()) // Parse the CSV
    .on('data', (row) => {
      console.log('Row:', row); // Debug: Log each row being parsed
      if (row.Article && row.Article.trim() === hotfixID) {
        patchFound = true;
        const releaseDate = row.Releasedate;
        

        const diffInDays = compareDates(releaseDate);

        // const message = `Hotfix ID: ${hotfixID}, Release Date: ${releaseDate}, Difference from today: ${diffInDays} days`;
        const message = {
          hotfixID: hotfixID,
          releaseDate: releaseDate,
          diffInDays: diffInDays,
        };
        console.log(message); // Debug: Log the message to the console

        sendToRenderer('update-output', message); // Send the message to the renderer
        readStream.destroy(); // Stop reading the CSV once we have found the Hotfix ID
      }
    })
    .on('end', () => {
      if (!patchFound) {
        const message = `Hotfix ID ${hotfixID} not found in the CSV file.`;
        console.log(message);
        sendToRenderer('update-output', message); // Send the not found message to the renderer
      }
    })
    .on('error', (err) => {
      console.error('Error reading the CSV file:', err);
      sendToRenderer('update-output', `Error reading the CSV file: ${err.message}`); // Send the error message to the renderer
    });
}

// Function to send data to the renderer
function sendToRenderer(channel, message) {
  if (mainWindow && mainWindow.webContents) {
    console.log(`Sending data to renderer (channel: ${channel}):`, message); // Debug log
    mainWindow.webContents.send(channel, message); // Send data to renderer
  } else {
    console.warn('MainWindow or WebContents is not available. Message not sent.'); // Handle the case where mainWindow is not available
  }
}


function compareDates(dateToCompare) {
  // Get today's date
  const today = new Date();
  
  // Parse the input date (e.g., "Aug 13, 2019")
  const compareDate = new Date(dateToCompare);
  
  // Check if the date was valid
  if (isNaN(compareDate)) {
    return "Invalid date format.";
  }
  
  // Calculate the time difference in milliseconds
  const diffInMs = today - compareDate;
  
  // Calculate the difference in various units
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  console.log(`${diffInDays} days`);
  return diffInDays;
}

ipcMain.on('fetch-hotfix-info', () => {
  // Automatically fetch the latest hotfix ID (assumed static for this example)
  const latestHotfixID = getLatestHotfix(); // Replace with logic to determine dynamically if needed
  fetchReleaseDateFromCSV(latestHotfixID);
});



//Getting anti virus information

function fetchAntivirusDetails() {
  const command = `powershell -Command "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -like '*antivirus*' -or $_.DisplayName -like '*McAfee*' -or $_.DisplayName -like '*Avast*' -or $_.DisplayName -like '*Kaspersky*' -or $_.DisplayName -like '*Trend Micro*' } | Select-Object DisplayName, DisplayVersion"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing PowerShell command: ${error.message}`);
      sendToRenderer('antivirus-data', { error: error.message });
      return;
    }

    if (stderr) {
      console.error(`PowerShell stderr: ${stderr}`);
      sendToRenderer('antivirus-data', { error: stderr });
      return;
    }

    try {
      const antivirusData = stdout
        .trim()
        .split('\n')
        .slice(2) // Skip headers
        .map(line => {
          const [displayName, displayVersion] = line.split(/\s{2,}/).map(item => item.trim());
          return { displayName, displayVersion };
        });

      console.log('Antivirus Details:', antivirusData); // Debug log
      sendToRenderer('antivirus-data', { data: antivirusData });
    } catch (parseError) {
      console.error('Error parsing PowerShell output:', parseError);
      sendToRenderer('antivirus-data', { error: 'Error parsing PowerShell output' });
    }
  });
}

// Function to send data to the renderer
function sendToRenderer(channel, message) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, message);
  } else {
    console.error('MainWindow or WebContents is not available.');
  }
}

module.exports = { fetchAntivirusDetails };



// Fetch OfficeScan software info using PowerShell
function fetchOfficeScanSoftware() {
  const command = `powershell -Command "Get-WmiObject -Class 'Win32_Product' -Namespace 'root\\cimv2' -ComputerName '.' -Filter \\\"Name like '%Officescan%' OR Name like '%Mcafee%' OR Name like '%avast%' OR Name like '%K7%' OR Name like '%Kaspersky%'\\\""`; 

  exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error(`Error executing PowerShell command: ${err}`);
      return;
    }
    
    if (stderr) {
      console.error(`PowerShell stderr: ${stderr}`);
      return;
    }

    try {
      const result = stdout; 
      mainWindow.webContents.send('officescan-data', result); 

      const antivirusList = parseAntivirusNames(stdout); // Parse names from the PowerShell output
      if (antivirusList.length > 0) {
        const antivirusData = fetchAntivirusVersion(antivirusList); // Fetch versions
        mainWindow.webContents.send('officescan-data2', antivirusData); 
      } else {
        mainWindow.webContents.send('officescan-data2', []); 
      }


    } catch (parseError) {
      console.error('Error parsing PowerShell output:', parseError);
    }
  });
}


function parseAntivirusNames(stdout) {
  const lines = stdout.split('\n');
  const antivirusNames = [];
  
  lines.forEach(line => {
    const match = line.match(/Name\s+:\s+(.*)/i);
    if (match) {
      antivirusNames.push(match[1].trim());
    }
  });

  return antivirusNames;
}


function fetchAntivirusVersion(antivirusList) {
  const antivirusData = [];

  
  antivirusList.forEach(antivirus => {
    
    const programFilesPaths = [
      process.env['ProgramFiles'],                 
      process.env['ProgramFiles(x86)'],           
    ];

    let searchPath = '';
    let found = false;

    // Search for the 'ofcscan.ini' in the available program files directories
    programFilesPaths.forEach(programFilesPath => {
      if (programFilesPath) {
        
        searchPath = path.join(programFilesPath, 'Trend Micro', 'OfficeScan Client', 'activeupdate', 'Saf', 'ofcscan.ini');

        
        if (fs.existsSync(searchPath)) {
          found = true;
          const configContent = fs.readFileSync(searchPath, 'utf-8');

          
          const versionMatch = configContent.match(/Pattern_Last_Update\s*=\s*(.*)/i);

          if (versionMatch) {
            antivirusData.push({
              name: antivirus,
              version: versionMatch[1].trim(),
            });
          } else {
            console.warn(`Version not found in config.ini for ${antivirus}`);
          }
        }
      }
    });

    if (!found) {
      console.warn(`config.ini not found for ${antivirus}`);
    }
  });

  return antivirusData;
}

module.exports = {
  fetchOfficeScanSoftware,
  fetchAntivirusVersion,
};


function extractValueFromConfig(configData, searchKey) {
  const regex = new RegExp(`^${searchKey}\\s*=\\s*(\\S+)`, 'm');
  const match = configData.match(regex);
  return match ? match[1] : null;
}


//Currently running antivirus 

function fetchRunningAntivirusProcesses() {
  const command = `powershell -Command "Get-Process | Where-Object { $_.ProcessName -match 'avast|kaspersky|mcafee|trendmicro|norton|antivirus|pccNTMon|TmsaInstance64|CNTAoSMgr|TmListen|Ntrtscan|TmccsF|Tmpfw|tmwscsvc' } | Select-Object ProcessName, Id, Description"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing PowerShell command: ${error.message}`);
      mainWindow.webContents.send('running-antivirus-data', { error: error.message });
      return;
    }

    if (stderr) {
      console.error(`PowerShell stderr: ${stderr}`);
      mainWindow.webContents.send('running-antivirus-data', { error: stderr });
      return;
    }

    try {
      // Process the PowerShell output
      const lines = stdout.trim().split('\n').filter(line => line.length > 0);

      // Skip the first line (usually a header or unwanted first process)
      const processLines = lines.slice(1); // This skips the first line in the output

      if (processLines.length === 0) {
        mainWindow.webContents.send('running-antivirus-data', { data: [] });
        return;
      }

      // Extract process details from the PowerShell output
      const processInfo = processLines.map(line => {
        // Match process name, ID, and description based on column positions
        const match = line.match(/^(\S+)\s+(\d+)\s+(.*)$/); // Regular expression to match ProcessName, ProcessId, Description
        
        if (match) {
          const processName = match[1];
          const processId = match[2];
          const processDescription = match[3].trim();

          return {
            processName: processName || 'Unknown',
            processId: processId || 'Unknown',
            processDescription: processDescription || 'No description available',
          };
        }

        return null; // If no match, return null (this case should be handled)
      }).filter(info => info !== null); // Filter out any null results (in case of unmatched lines)

      // Send the data to the renderer process
      mainWindow.webContents.send('running-antivirus-data', { data: processInfo });
    } catch (parseError) {
      console.error('Error parsing PowerShell output:', parseError);
      mainWindow.webContents.send('running-antivirus-data', { error: 'Error parsing PowerShell output' });
    }
  });
}





function getNetworkInfo() {
  const networkInterfaces = os.networkInterfaces();
  const interfaces = [];

  for (let interfaceName in networkInterfaces) {
    networkInterfaces[interfaceName].forEach(interfaceDetails => {
      if (interfaceDetails.family === 'IPv4' && interfaceDetails.internal === false) {
        interfaces.push({
          interfaceName: interfaceName,
          macAddress: interfaceDetails.mac,
          ipAddress: interfaceDetails.address
        });
      }
    });
  }

  return interfaces;
}

// Patch updates
function getPatches() {
  if (os.platform() !== 'win32') {
    return Promise.resolve('Patch information not available for this platform.');
  }

  return new Promise((resolve, reject) => {
    wmi.Query({
      class: 'Win32_QuickFixEngineering'
    }, (err, result) => {
      if (err) {
        reject('Failed to retrieve patch information');
      } else {
        if (result && result.length > 0) {
          const patches = result.map(patch => {
            return {
              description: patch.Description,
              installedOn: patch.InstalledOn,
              hotFixID: patch.HotFixID,
              installedBy: patch.InstalledBy,
            };
          });
          resolve(patches);
        } else {
          resolve('No patches found.');
        }
      }
    });
  });
}

//WMI querry to get running process
function fetchSoftwareInfo() {
  const client = new WMIClient({
    host: 'localhost',
    username: '', 
    password: '', 
  });

  const Query = `SELECT Name, InstallLocation, InstallDate, Version FROM Win32_Product`;

  client.query(Query, function (err, result) {
    if (err) {
      console.error('WMI Query Error:', err);
      return;
    }

    if (result.length === 0) {
      console.log('No software found.');
    } else {
      console.log(`Found ${result.length} software items.`);  
    }
    
    // Send the result to the renderer process
    mainWindow.webContents.send('software-data', result);
  });
}
