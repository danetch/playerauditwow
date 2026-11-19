
/*the goal of this method is to :
1. Get the last raid before currentdate from wcl to know when was the last Raid, and what caracteristics it had, most notably, its difficulty and date.
  a. get the attendance on the last 5 reports, and get the last one that was logged on the sunday/wednesday.
2. Based on the last raid date and difficulty, check performance on that difficulty and use this report to understand the last survivability.
3. Check attendance on players
4. Check historical wa data based on last week's dungeons.
5. check last raid's deaths
*/
function startProcessing() {
  addWeekNumberCapability();
  var currentDate = new Date();
  // doing #1 Performance (&#2) finally, wcl gives you auto without you having to know difficulty zone or date)
  var token = getWCLToken(wclV2Id,wclV2Secret);
  var wclInfo = getWCLInfo(token);
  let lastReportTS =  PropertiesService.getScriptProperties().getProperty("lastReportTS");
  if(lastReportTS!=null&&wclInfo.lastReportTimeStamp==lastReportTS){
    let lastReportDate = new Date(parseFloat(lastReportTS));
    Logger.log("last report registered is  : "+lastReportDate);
    return;
  }
  // doing #3 Stabilité / Présence
  var startDate = getPatchStartDate(currentDate);
  var attendance = getWAAttendance(waSecret,startDate);
  // doing #4 Équipement / Donjons
  var dungeons = getWAHistoricalData(); // on prend toujours la semaine précédente
  addPlayersIlvl(dungeons);// dungeons need to be augmented with ILVL Data
  // doing #5 Deaths
  var survie = getWCLDeaths(wclInfo.reportCode,wclInfo.fightIds,token);
  let indicators = computeIndicators(startDate,attendance,wclInfo,dungeons,survie);
  PropertiesService.getScriptProperties().setProperty("lastReportTS",wclInfo.lastReportTimeStamp);
  displayData(indicators);
}
function displayData(indicators){
  var document = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = document.getSheetByName("DataIndicateur");
  let weeklater = new Date(indicators.stuffCheckDate.getTime()+(1000*3600*24*6));
  let verifPeriod = weeklater.toISOString().slice(0,10);
  for(let character in indicators.players){
    let player = indicators.players[character];
    let indicator = player.attendancePoints+player.stuffPoints+player.perfPoints+player.deathPoints;
    sheet.appendRow([character,player.attendancePoints,player.stuffPoints,player.perfPoints,player.deathPoints,player.activeLastRaid?(indicator):null,player.activeLastRaid?indicators.lastReportDate:null,verifPeriod]);

  }
}
// attribute points based on perf
function perfPoints(perf)
{
  let y = 0;
  if(perf<45)return 0;
  if(perf>=45&&perf<50)
  {
    y = ((perf-45)**3)/12.5
  }
  else{
    y = (perf/2.5)-10
  }
  /* old algo
  let x = perf;
  
  y=-8.8054*10**(-9)*x**6+0.00000353004*x**5-0.000587672*x**4+0.052807*x**3-2.75856*x**2+81.3623*x-1055.63;
  if(y>30)return 30;*/
  
  return Math.round(y);
}
function presPoints(attendance){

  if(attendance<75)return 0;
  let points = 20-((100-attendance)*20/25);

  return Math.round(points);
}
function deathsPoints(playerDeath,totalDeaths,numActors){
  let points  = 30 - (playerDeath*15*numActors/totalDeaths);
  if(points<0)points=0;
  return Math.round(points)
}

function stuffPoints(twoOptions,threeOptions,playerIlvl,slot2ilvl,slot3ilvl){
  if(playerIlvl>=slot2ilvl+14){
    return 20;
  }
  let score = 0;
  if(twoOptions!=null&twoOptions>=slot2ilvl){
    score+=10
  }
  if(threeOptions!=null&threeOptions>=slot3ilvl){
    score+=10
  }
  return score;
  /* old algo
  if((currentDate-startDate)<1000*3600*24*35)
  {
    if(threeOptions){
      return 20;
    }
    if(twoOptions){
      return 15;
    }
  }else{
    if(twoOptions)return 20;
  }
  return 0;*/
}

// This function needs to change : This shouldn't have baked in points computations, but it should retrieve values for each indicator, and normalize values
function computeIndicators(startDate,attendance, wclInfo,dungeons,survie){
  let indicators = {};
  indicators.players = {};
  let morts = survie.morts;
  let deathTotal =  survie.total;
  indicators.patchStartDate = startDate;
  indicators.lastReportDate = new Date(wclInfo.lastReportTimeStamp);
  indicators.stuffCheckDate = dungeons.stuffCheckDate;
  let attChars =  attendance.characters;
  for(let key in attChars)
  {
    let player = attChars[key];
    indicators.players[player.name] = {};
    indicators.players[player.name].attendance = player.attended_percentage;
    indicators.players[player.name].activeLastRaid = morts[player.name]!=null;
    indicators.players[player.name].attendancePoints = presPoints(player.attended_percentage);
    if(indicators.players[player.name].activeLastRaid){
      indicators.players[player.name].deathPoints = deathsPoints(morts[player.name],deathTotal,survie.numActors);
    }
  }
  let perfPlayers = wclInfo.players;
  for(let key in perfPlayers)
  {
    let player = perfPlayers[key];
    indicators.players[player.name].perf = player.perf;
    indicators.players[player.name].perfPoints = perfPoints(player.perf);
  }
  let dungeonPlayers = dungeons.characters;
  for(let key in dungeonPlayers)
  {
    let player = dungeonPlayers[key];
    if(player.data!=null){
      indicators.players[player.name].stuffPoints = stuffPoints(player.data.vault_options.dungeons.option_2,player.data.vault_options.dungeons.option_3,player.ilvl,dungeons.slot2ilvl,dungeons.slot3ilvl)
    }
    else indicators.players[player.name].stuffPoints = 0;
  }
  for(let character in morts){
    if(indicators.players[character]!=null)indicators.players[character].deaths = morts[character];
  }
  return indicators;
}





/* this tells which is the nearest startdate for a patch based on
1. when the raids stopped being scheduled for more than 2 weeks.
2. which is the closest start : this is end of the last gap always.
*/
function getPatchStartDate(currentDate){
  var patchStartTimeStamp = PropertiesService.getScriptProperties().getProperty("patchStartTimeStamp");
  if(patchStartTimeStamp!=null){
    // check si on est en pause ou proche de l'être
    if((currentDate.getTime()-patchStartTimeStamp)<1000*3600*24*140)
    {
      return new Date(patchStartTimeStamp);
    }
  }
  var waRaids = getWARaids();
  var lastGap = {start:0,end:0};
  var lastRaid = 0;
  var previousTime = 0;
  for(var key in waRaids.raids){
    var raid = waRaids.raids[key];
    let time = Date.parse(raid.date);
    if(previousTime!=0)
    {
      if(currentDate.getTime()<time)continue;
      if(time-previousTime>1000*3600*24*14) // 14 days gap
      {        
        if(lastGap.end<time){
          lastGap.end = time;
          lastGap.start = previousTime;
        }
      }
    }
    previousTime=time;
  }
  Logger.log("we have a last Gap, start is : "+new Date(lastGap.start)+ " and end is :" + new Date(lastGap.end));
  //PropertiesService.getScriptProperties.setProperty("patchStartTimeStamp",lastGap.end);
  return new Date(lastGap.end);
  }
function getWARaids()
{
  var url = wowAuditURL + "v1/raids?include_past=true";
  var options = {"method":"get","headers":{"Authorization":"Bearer "+waSecret},"contentType":"application/json"};
  return JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
}
/* get the ranking info from warcraftlogs, but also the last difficulty.
1. Get the last raid / difficulty of fights. sum up the difficulty between the last 2 reports
2. get the performance
*/
function getWCLInfo(token){
  var wclInfo = {};
  let query = `query($page: Int,$limit: Int){
	reportData{
		reports(guildName:"Øgma Tuatha",guildServerSlug:"ysondre",guildServerRegion:"eu",page:$page,limit:$limit){
			data{
				code
				startTime
				fights{
          id
					difficulty
          encounterID
				}
			}
		}
	}}`;
  let variables = {page:1,limit:2};
  let payload = {query:query,variables:variables};
  let options = {"method":"post","headers":{"Authorization":"Bearer "+token},"contentType":"application/json","payload":JSON.stringify(payload)};
  let reports = JSON.parse(UrlFetchApp.fetch(wclV2URL,options).getContentText()).data.reportData.reports.data;
  // looking at all reports
  wclInfo.difficulties = [];
  wclInfo.fightIds = [];
  for(let key in reports){
    //looking at fights in the reports
    let report = reports[key];
    let day = new Date(report.startTime).getUTCDay();
    if(day == 2 || day == 4 || day == 5 ||day == 6 )continue;
    for(let entry in report.fights){
      let fight = report.fights[entry]
      if(fight.difficulty!=null&&fight.difficulty<6)
      {
        // registering the report date, because it is meaningfull, since it has fights with ok difficulty
        if(wclInfo.lastReportTimeStamp==null)wclInfo.lastReportTimeStamp=report.startTime;
        if(wclInfo.reportCode == null)wclInfo.reportCode = report.code;
        else{
          if(wclInfo.reportCode == report.code && fight.encounterID!=null)
          {
            wclInfo.fightIds.push(fight.id);
          }
        }
        if(wclInfo.difficulties[fight.difficulty]!=null){
          wclInfo.difficulties[fight.difficulty] += 1;
        }
        else
        {
          wclInfo.difficulties[fight.difficulty]=1;
        }

      }
    }
  }
  // move on to performance
  let players = getWCLPerformance(token);
  wclInfo.players =  players;
  return wclInfo;
}

function getWAAttendance(secret,startDate){
  var url = wowAuditURL + "v1/attendance?start_date="+startDate;
  var options = {"method":"get","headers":{"Authorization":"Bearer "+secret},"contentType":"application/json"};
  return JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
}
function getWCLToken(key,pwd){
  var options = {"method":"post","headers":{"authorization":"Basic "+Utilities.base64Encode(Utilities.newBlob(key+":"+pwd).getBytes())},"payload":{grant_type:"client_credentials"}};
  return JSON.parse(UrlFetchApp.fetch(wclAuthURL,options).getContentText()).access_token;
}
function getWowAuditPlayers(secret){
  var url = wowAuditURL + "v1/characters";
  var options = {"method":"get","headers":{"Authorization":"Bearer "+secret},"contentType":"application/json"};
  return JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
}
function addPlayersIlvl(dungeons){
  let characters = dungeons.characters;
  // this is going to be iterating on each player. Probably stay simple in processing
  let maxIlvl = 0;
  let slots = {slot2:{}, slot3:{}};
  for (var key in characters){
    let player =  characters[key];
    player.ilvl = getPlayerIlvl(player.id);
    if(player.ilvl>maxIlvl)maxIlvl = player.ilvl;
    if(player.data!=null){
      if(player.data.vault_options.dungeons.option_2!=null&&slots.slot2[player.data.vault_options.dungeons.option_2]!=null)
      {
        slots.slot2[player.data.vault_options.dungeons.option_2]+=1;
      }
      else{
        if(player.data.vault_options.dungeons.option_2!=null){
          slots.slot2[player.data.vault_options.dungeons.option_2]=1;
        }
      }
      if(player.data.vault_options.dungeons.option_3!=null&&slots.slot3[player.data.vault_options.dungeons.option_3]!=null)
      {
        slots.slot3[player.data.vault_options.dungeons.option_3]+=1;
      }
      else{
        if(player.data.vault_options.dungeons.option_3!=null){
          slots.slot3[player.data.vault_options.dungeons.option_3]=1;
        }
      }
    }
  }
  dungeons.maxIlvl = maxIlvl;
  let maxSlot2 = 0;
  let maxSlot3 = 0;
  Logger.log(slots);
  for(let key in slots.slot2)
  {
    if(slots.slot2[key]>maxSlot2){
      maxSlot2 = slots.slot2[key];
      dungeons.slot2ilvl = key;
    }
  }
  for(let key in slots.slot3)
  {
    if(slots.slot3[key]>maxSlot3){
      maxSlot3 = slots.slot3[key];
      dungeons.slot3ilvl = key;
    }
  }
}
function getPlayerIlvl(id){
  let url = wowAuditURL + "v1/historical_data/"+id;
  let options = {"method":"get","headers":{"Authorization":"Bearer "+waSecret},"contentType":"application/json"};
  let response = JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
  let ilvl = 0;
  let slots = 0;
  for(let key in response.best_gear)
  {
    if(key=="off_hand")continue;
    let slot = response.best_gear[key];
    ilvl += slot.ilvl;
    ++slots;
  }
  return ilvl/slots;

}

function getWAHistoricalData(){
  /*
  this method used to take in a date object named "today"
  let weekNum = today.iso8601Week();
  let year = today.getFullYear();
  if(weekNum==1)
  {
    weekNum = 52;
    year = year-1;
  }
  else{weekNum = weekNum -1}
  var url = wowAuditURL + "v1/historical_data?year="+year+"&week="+weekNum;
  */
  let period = getWAPeriod()-1;
  let url = wowAuditURL + "v1/historical_data?period="+period;
  let options = {"method":"get","headers":{"Authorization":"Bearer "+waSecret},"contentType":"application/json"};
  let dungeons = JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
  dungeons.stuffCheckDate = getDateForPeriod(period);
  return dungeons;
}
function getWAPeriod(){
  let url = wowAuditURL + "v1/period";
  var options = {"method":"get","headers":{"Authorization":"Bearer "+waSecret},"contentType":"application/json"};
  let response = JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
  return response.current_period;
}
function getDateForPeriod(period){
  let tokenOptions = {"method":"post","headers":{"Authorization":"Basic "+Utilities.base64Encode(bnetId+":"+bnetSecret)},"payload":{"grant_type":"client_credentials"}};
  let response = UrlFetchApp.fetch(bnetAuthURL,tokenOptions);
  let token = JSON.parse(response.getContentText()).access_token;
  let options = {"method":"get","headers":{"Authorization":"Bearer "+token, "Battlenet-Namespace":"dynamic-eu"},"contentType":"application/json"};
  let url = bnetURL+"data/wow/mythic-keystone/period/"+period;
  let stamps = JSON.parse(UrlFetchApp.fetch(url,options).getContentText());
  return new Date(stamps.start_timestamp);
}


function getWCLPerformance(token){
  let query = `query($name: String,$server: String,$region: String,$byBracket: Boolean){
  characterData{
		character(name:$name, serverSlug:$server, serverRegion:$region){
			name
			zoneRankings(partition:-1,byBracket:$byBracket)
		}
	}}`;
  let players = getWowAuditPlayers(waSecret);
  let options = {"method":"post","headers":{"Authorization":"Bearer "+token},"contentType":"application/json"};
  for(let key in players)
  {
    let player = players[key];
    let variables = {name:player.name,region:"eu",server:slugify(player.realm),byBracket:true };
    let variab2 = {name:player.name,region:"eu",server:slugify(player.realm),byBracket:false };
    options.payload = JSON.stringify({query:query,variables:variables});
    let perfBracket = JSON.parse(UrlFetchApp.fetch(wclV2URL,options).getContentText()).data.characterData.character.zoneRankings.bestPerformanceAverage;
    options.payload = JSON.stringify({query:query,variables:variab2});
    let perfOverall = JSON.parse(UrlFetchApp.fetch(wclV2URL,options).getContentText()).data.characterData.character.zoneRankings.bestPerformanceAverage;
    player.perf = perfOverall>perfBracket?perfOverall:perfBracket;
  }
  return players; 
}
function getWCLDeaths(reportCode,fightIds,token){
  let output = {};
  let rapport = {};
  let query = `query($code: String,$fightIDs: [Int]){
	reportData{
		report(code:$code){
			graph(dataType:Deaths,wipeCutoff:3,fightIDs:$fightIDs)
			masterData{
				actors(type:"player"){
					name
          server
				}
			}
		}
	}}`;
  let variables = {code:reportCode,fightIDs:fightIds};
  let options = {"method":"post","headers":{"Authorization":"Bearer "+token},"contentType":"application/json"};
  options.payload = JSON.stringify({query:query,variables:variables});
  let response = JSON.parse(UrlFetchApp.fetch(wclV2URL,options).getContentText());
  let deaths = response.data.reportData.report.graph.data.series;
  let actors = response.data.reportData.report.masterData.actors;
  let sum = 0;
  let highest = 0;
  let lowest = 1;
  for(let key in deaths){

    let deathRecap = deaths[key].data;
    rapport[deaths[key].name] = deathRecap.length;
    sum += deathRecap.length;
    if(highest<deathRecap.length)highest = deathRecap.length;
  }
  for(let key in actors){
    let actor = actors[key];
    if (rapport[actor.name]==null)
    {
      rapport[actor.name] = 0;
      lowest = 0;
    }
  }
  output.morts = rapport;
  output.actors = actors;
  output.total = sum;
  output.hightest = highest;
  output.lowest = lowest;
  output.numActors = Object.keys(rapport).length;
  return output;
    
}
function slugify(server){
  return server.replace(/\s/g, "");
}
function addWeekNumberCapability(){
  Date.prototype.iso8601Week = function () {
  // Create a copy of the current date, we don't want to mutate the original
  const date = new Date(this.getTime());

  // Find Thursday of this week starting on Monday
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const thursday = date.getTime();

  // Find January 1st
  date.setMonth(0); // January
  date.setDate(1);  // 1st
  const jan1st = date.getTime();

  // Round the amount of days to compensate for daylight saving time
  const days = Math.round((thursday - jan1st) / 86400000); // 1 day = 86400000 ms
  return Math.floor(days / 7) + 1;
  };
}
function firstDayOfWeek(week, year) {
    if (year==null) {
        year = (new Date()).getFullYear();
    }

    var date       = firstWeekOfYear(year),
        weekTime   = weeksToMilliseconds(week),
        targetTime = date.getTime() + weekTime;
    return date.setTime(targetTime);
}

function weeksToMilliseconds(weeks) {
    return 1000 * 60 * 60 * 24 * 7 * (weeks - 1);
}

function firstWeekOfYear(year) {
    var date = new Date();
    date = firstDayOfYear(date,year);
    date = firstWeekday(date);
    return date;
}

function firstDayOfYear(date, year) {
    date.setYear(year);
    date.setDate(1);
    date.setMonth(0);
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}

/**
 * Sets the given date as the first day of week of the first week of year.
 */
function firstWeekday(firstOfJanuaryDate) {
    // 0 correspond au dimanche et 6 correspond au samedi.
    var FIRST_DAY_OF_WEEK = 1; // Monday, according to iso8601
    var WEEK_LENGTH = 7; // 7 days per week
    var day = firstOfJanuaryDate.getDay();
    day = (day === 0) ? 7 : day; // make the days monday-sunday equals to 1-7 instead of 0-6
    var dayOffset=-day+FIRST_DAY_OF_WEEK; // dayOffset will correct the date in order to get a Monday
    if (WEEK_LENGTH-day+1<4) {
        // the current week has not the minimum 4 days required by iso 8601 => add one week
        dayOffset += WEEK_LENGTH;
    }
    return new Date(firstOfJanuaryDate.getTime()+dayOffset*24*60*60*1000);
}