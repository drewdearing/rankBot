require('dotenv').config()

const Discord = require('discord.js')
const admin = require('firebase-admin')
const fs = require('fs')
const request = require('request')
const cheerio = require('cheerio')

const client = new Discord.Client()
var serviceAccount = require('./rankbot-1ada2-firebase-adminsdk-t3q8e-d1343deb01.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://rankbot-1ada2.firebaseio.com"
})

const db = admin.firestore()
var FieldValue = admin.firestore.FieldValue;

let members = {}
let players = {}
let max_points = 0

try{
	const data_file = fs.readFileSync('./resurrected-data.json', 'utf8')
	try{
		const data = JSON.parse(data_file)
		try{
			members = data.members
		}
		catch(err){
			members = {}
		}
		try{
			players = data.players
		}
		catch(err){
			players = {}
		}
		try{
			max_points = data.max_points
		}
		catch(err){
			max_points = 0
		}
	}
	catch(err){
		console.error(err)
	}
}
catch(err){
	console.error(err)
}

const ranks = {
	"Diamond": 0.995,
	"Platinum": 0.95,
	"Gold": 0.75,
	"Silver": 0.4,
	"Bronze": 0,
	"Unranked": 0
}

function overallRank(player_name, playersData, msg){
	if(player_name.toLowerCase() in playersData){
		let player = playersData[player_name.toLowerCase()]
		let rank = player.rank
		if(rank != undefined){
			if(player.active){
				msg.reply("`"+player.name+"` is rank "+rank+".")
			}
			else{
				msg.reply("`"+player.name+"` is rank "+rank+" overall, but is currently inactive.")
			}
		}
		else{
			msg.reply("`"+player.name+"'s` rank has not been updated.")
		}
	}
	else{
		msg.reply("player `"+player_name+"` is not recognized.")
	}
}

function newTagRole(member, msg){
	let guild = msg.guild
	if(guild != null){
		if(member in members){
			let player_name = members[member]
			let guildMember = guild.members.find(gMember => gMember.id == member)
			if(guildMember != null){
				if(player_name in players && players[player_name].active){
					let player = players[player_name]
					if(player.active){
						let new_role = "Bronze"
						if(player.points >= ranks.Silver*max_points)
							new_role = "Silver"
						if(player.points >= ranks.Gold*max_points)
							new_role = "Gold"
						if(player.points >= ranks.Platinum*max_points)
							new_role = "Platinum"
						if(player.points >= ranks.Diamond*max_points)
							new_role = "Diamond"
						guildMember.addRole(guild.roles.find(role => role.name === new_role)).then(() => {
							msg.reply("your role will now reflect your ranking if you are currently active.")
							guildMember.removeRoles(guild.roles.filter(role => role.name != new_role && role.name in ranks)).catch(console.log)
						}).catch(console.log)
					}
				}
				else{
					let new_role = "Unranked"
					guildMember.addRole(guild.roles.find(role => role.name === new_role)).then(() => {
						msg.reply("you need to attend a tournament within the last 30 days to recieve a ranking!")
						guildMember.removeRoles(guild.roles.filter(role => role.name != new_role && role.name in ranks)).catch(console.log)
					}).catch(console.log)
				}
			}
		}
		else{
			let guildMember = guild.members.find(gMember => gMember.id == member)
			if(guildMember != null){
				let new_role = "Unranked"
				guildMember.addRole(guild.roles.find(role => role.name === new_role)).then(() => {
					guildMember.removeRoles(guild.roles.filter(role => role.name != new_role && role.name in ranks)).catch(console.log)
				}).catch(console.log)
			}
		}
	}
	else{
		msg.reply("to update server roles, please use this command in a server!")
	}
}

function updateRoles(msg){
	let guild = msg.guild

	if(guild != null){
		for(member_id in members){
			let player_name = members[member_id]
			let guildMember = guild.members.find(gMember => gMember.id == member_id)
			if(guildMember != null){
				if(player_name in players && players[player_name].active){
					let player = players[player_name]
					if(player.active){
						let new_role = "Bronze"
						if(player.points >= ranks.Silver*max_points)
							new_role = "Silver"
						if(player.points >= ranks.Gold*max_points)
							new_role = "Gold"
						if(player.points >= ranks.Platinum*max_points)
							new_role = "Platinum"
						if(player.points >= ranks.Diamond*max_points)
							new_role = "Diamond"
						guildMember.addRole(guild.roles.find(role => role.name === new_role)).then(() => {
							guildMember.removeRoles(guild.roles.filter(role => role.name != new_role && role.name in ranks)).catch(console.log)
						}).catch(console.log)
					}
				}
				else{
					let new_role = "Unranked"
					guildMember.addRole(guild.roles.find(role => role.name === new_role)).then(() => {
						guildMember.removeRoles(guild.roles.filter(role => role.name != new_role && role.name in ranks)).catch(console.log)
					}).catch(console.log)
				}
			}
		}
	}
	else{
		msg.reply("to update server roles, please use this command in a server!")
	}
}

function updateBraacketPlayer(player){
	return new Promise((resolve, reject) => {
		if(!player.updated){
			request(player.url, {json: false}, (err, res, body) => {
				if(!err){
					const $ = cheerio.load(body)
					let dashboard_values = $("div.panel-body").find("div.my-dashboard-values-sub")
					let dashboard_rankings = $("div.panel-body").find("div.my-dashboard-values-main:contains('out of')")
					if(dashboard_values.length > 0 && dashboard_rankings.length > 0){
						player.rank = parseInt(dashboard_rankings.text().trim().match(new RegExp('[0-9]+'))[0])
						dashboard_values.each(function(i, elem){
							if($(this).find("div:contains('Points')").length > 0){
								player.points = parseInt($(this).children('div').eq(1).text().trim())
								if(player.points > max_points){
									max_points = player.points
								}
							}
							if($(this).find("div:contains('Activity requirement')").length > 0){
								player.active = $(this).find("span").length <= 0
							}
						})
						player.updated = true
						resolve(player)
					}
				}
				reject(player)
			})
		}
		else{
			resolve(player)
		}
	})
}

function updatePlayerData(service, playersID, timeout, temp_players, callback){
	if(service === 'braacket'){
		timoutPromise(timeout, function(resolve, reject, endTime){
			Promise.all(Object.values(temp_players).map(updateBraacketPlayer)).then(function(){
				resolve()
			}).catch(function(err){
				reject(endTime - (new Date()).getTime())
			})
		}).then(function(){
			let playersDB = db.collection('players').doc(playersID)
			playersDB.set(temp_players)
			callback(true)
		}).catch(function(remainingTime){
			if(remainingTime > 0){
				updatePlayerData(service, playersID, remainingTime, temp_players, callback)
			}
			else{
				callback(false)
			}
		})
	}
	else{
		callback(false)
	}
}

function braacketGetPlayers(params){
	return new Promise((resolve, reject) => {
		request('https://braacket.com/league/'+params.id+'/player?rows='+params.rows+'&page='+params.page, { json: false }, (err, res, body) => {
			const $ = cheerio.load(body)
			let player_fields = $('table.table.table-hover.my-table-checkbox')
			if (err || player_fields.length <= 0) {
				reject({id, page})
			}
			else{
				let values = {}
				player_fields.find('tbody').find('a').each(function(i, elem){
					values[$(this).text().toLowerCase()] = {
						"id": $(this).text().toLowerCase(),
						"name": $(this).text(),
						"points": undefined,
						"rank": undefined,
						"active": false,
						"url": "https://braacket.com" + $(this).attr('href'),
						"updated": false
					}
				})

				resolve(values)
			}
		})
	})
}

function braacketGetPages(id, rows){
	return new Promise((resolve, reject) => {
		request('https://braacket.com/league/'+id+'/player?rows='+rows, { json: false }, (err, res, body) => {
			const $ = cheerio.load(body)
			let displaying_field = $("div.input-group-addon.my-input-group-addon:contains('Rows')")
			if (err || displaying_field.length <= 0) {
				reject({err})
			}
			else{
				let total = parseInt(displaying_field.text().match(new RegExp('of [0-9]+'))[0].split(" ")[1])
				let pages = Math.ceil(total/rows)
				resolve({pages})
			}
		})
	})
}

function updatePlayers(service, id, playersID, timeout, callback){
	if(service === 'braacket'){
		timoutPromise(timeout, function(resolve, reject, endTime){
			braacketGetPages(id, 500).then(function(values){
				let pages = values.pages
				let params = []
				for(i = 1; i <= pages; i++){
					params.push({page: i, rows: 500, id: id})
				}
				Promise.all(params.map(braacketGetPlayers)).then(function(values){
					let temp_players = {}
					for(v in values){
						let page = values[v]
						Object.keys(page).forEach(function(key) { temp_players[key] = page[key] })
					}
					resolve({temp_players: temp_players, remainingTime: endTime - (new Date()).getTime()})
				}).catch(function(err){
					reject(endTime - (new Date()).getTime())
				})
			}).catch(function(err){
				reject(endTime - (new Date()).getTime())
			})
		}).then(function(values){
			updatePlayerData(service, playersID, values.remainingTime, values.temp_players, callback)
		}).catch(function(remainingTime){
			if(remainingTime > 0){
				updatePlayers(service, id, playersID, remainingTime, callback)
			}
			else{
				callback(false)
			}
		})
	}
	else{
		callback(false)
	}
}

function timoutPromise(ms, callback) {
    return new Promise(function(resolve, reject) {
        let currentTime = (new Date()).getTime()
        callback(resolve, reject, currentTime + ms)

        setTimeout(function() {
            reject(0)
        }, ms)
    })
}

function playerTagTaken(tag, memberData){
	for(member in memberData){
		if(memberData[member].toLowerCase() === tag.toLowerCase())
			return true
	}
	return false
}

function tag_command(msg, message_parts){
	let member = msg.author.id
	let guild = msg.guild
	if(guild != null){
		let guild_id = guild.id
		let guildDB = db.collection('guilds').doc(guild_id)
		guildDB.get().then((guildDoc) => {
			if(guildDoc.exists){
				let membersID = guildDoc.data().members
				let membersDB = db.collection('members').doc(membersID)
				membersDB.get().then((membersDoc) => {
					if(message_parts.length > 1){
						if(message_parts[1] === 'unlink'){
							if(message_parts.length > 2){
								//unlink a player_name
								let tag = message_parts.slice(2, message_parts.length).join(" ")
								let guildMember = guild.members.find(gMember => gMember.id == member)
								if(guildMember != null && guildMember.hasPermission('ADMINISTRATOR')){
									let memberData =  membersDoc.data()
									let removed = []
									for(m in memberData){
										if(memberData[m] === tag){
											memberData[m] = FieldValue.delete()
											removed.push(m)
										}
									}

									membersDB.update(memberData).then(function(){
										for(r in removed){
											newTagRole(removed[r], msg)
										}
										msg.reply("tag unlinked!")
									})
								}
								else{
									msg.reply("you do not have permission to use this command!")
								}
							}
							else{
								//unlink self
								let memberData = {}
								memberData[member] = FieldValue.delete()
								membersDB.update(memberData).then(function(){
									msg.reply("tag unlinked!")
									newTagRole(member, msg)
								})
							}
						}
						else{
							let tag = message_parts.slice(1, message_parts.length).join(" ").toLowerCase()
							if(!playerTagTaken(tag, membersDoc.data())){
								let memberData = {}
								memberData[member] = tag
								membersDB.update(memberData).then(function(){
									msg.reply("tag set!")
									newTagRole(member, msg)
								})
							}
							else{
								msg.reply("tag `"+tag+"` already linked to another account!\n\nUse `!tag unlink` to unlink your tag.")
							}
						}
					}
					else{
						let memberData = membersDoc.data()
						if(member in memberData){
							msg.reply("your tag is currently set to `"+memberData[member]+"`.")
						}
						else{
							msg.reply("your tag is not currently set!\n\nUse `!tag <player>` to associate your account with your Smash Tag!")
						}
					}
				})
			}
			else{
				msg.reply("your server is not initialized with a league!\n\nUse `!league set` to get started!")
			}
		})
	}
	else{
		msg.reply("please use this command in a server!")
	}
}

function league_command(msg, message_parts){
	let member = msg.author.id
	let guild = msg.guild
	if(guild != null){
		let guild_id = guild.id
		let guildDB = db.collection('guilds').doc(guild_id)
		guildDB.get().then((guildDoc) => {
			if(message_parts.length > 1 && message_parts[1] === 'set'){
				if(message_parts.length > 2){
					if(message_parts.length == 3){
						let league_id = message_parts.slice(2, message_parts.length).join(" ")
						let leagueDB = db.collection('leagues').doc(league_id)
						if(!guildDoc.exists){
							let membersDB = db.collection('members').doc()
							guildDB.set({
								league_id: league_id,
								members: membersDB.id
							})
						}
						else{
							guildDB.update({
								league_id: league_id
							})
						}
						leagueDB.get().then((doc) => {
							if(!doc.exists){
								let playersDB = db.collection('players').doc()
								leagueDB.set({
									owner: member,
									mod:[],
									private: false,
									max_points: 0,
									service: "",
									players: playersDB.id,
									id: "",
									ranks: {}
								})
							}
						})
						msg.reply("league set!")
					}
					else{
						msg.reply("a league id cannot include spaces.")
					}
				}
				else{
					msg.reply("please provide a league_id.")
				}
			}
			else if(!guildDoc.exists){
				msg.reply("your server is not initialized with a league!\n\nUse `!league set` to get started!")
			}
			else{
				let league_id = guildDoc.data().league_id
				let leagueDB = db.collection('leagues').doc(league_id)
				leagueDB.get().then((leagueDoc) => {
					if(!leagueDoc.exists){
						msg.reply("the league associated with this server cannot be found.")
					}
					else{
						if(message_parts.length > 1){
							if(message_parts[1] === 'service'){
								if(message_parts.length == 4){
									let new_service = message_parts[2]
									let new_service_id = message_parts[3]
									leagueDB.update({
										service: new_service,
										id: new_service_id
									})
									msg.reply("league service set!")
								}
								else{
									msg.reply("this command requires 2 arguments.")
								}
							}
							else if(message_parts[1] === 'ranks'){
								if(message_parts.length > 2){
									if(message_parts[2] === 'add'){
										if(message_parts.length >= 5){
											let name = message_parts.slice(3, message_parts.length-1).join(" ")
											let percentile = null
											try{
												percentile = parseFloat(message_parts[message_parts.length-1])
											}
											catch(err){
												msg.reply("percentile must be a number!")
											}

											if(name != null && percentile != null){
												let currentRanks = leagueDoc.data().ranks
												if(name.toLowerCase() in currentRanks){
													msg.reply("this rank already exists!\n\nUse `!league ranks remove <name>` to remove a rank!")
												}
												else{
													if(percentile < 0){
														msg.reply("percentile must be positive.")
													}
													else{
														currentRanks[name.toLowerCase()] = percentile
														leagueDB.update({
															ranks:currentRanks
														})
														msg.reply("rank added!")
													}
												}
											}
											else{
												msg.reply("there was a problem creating new rank!")
											}

										}
										else{
											msg.reply("this command requires 2 arguments.")
										}
									}
									else if(message_parts[2] === 'remove'){
										if(message_parts.length >= 4){
											let name = message_parts.slice(3, message_parts.length).join(" ")
											let currentRanks = leagueDoc.data().ranks
											if(name.toLowerCase() in currentRanks){
												delete currentRanks[name.toLowerCase()]
												leagueDB.update({
													ranks:currentRanks
												})
											}
											msg.reply("rank removed.")
										}
										else{
											msg.reply("please provide a rank name.")
										}
									}
								}
								else{
									let currentRanks = Object.keys(leagueDoc.data().ranks)
									if(currentRanks.length > 0){
										msg.reply("the current ranks are "+currentRanks.join(", "))
									}
									else{
										msg.reply("there are no ranks associated with `"+league_id+"`\n\nUse `!league ranks add <name> <percentile>` to add new ranks")
									}
								}
							}
						}
						else{
							msg.reply("this server is associated with `"+league_id+"`")
						}
					}
				})
			}
		})
	}
	else{
		msg.reply("please use this command in a server!")
	}
}

function update_command(msg, message_parts){
	let member = msg.author.id
	let guild = msg.guild
	if(message_parts.length == 1){
		if(guild != null){
			let guild_id = guild.id
			let guildDB = db.collection('guilds').doc(guild_id)
			guildDB.get().then((guildDoc) => {
				if(!guildDoc.exists){
					msg.reply("your server is not initialized with a league!\n\nUse `!league set` to get started!")
				}
				else{
					let league_id = guildDoc.data().league_id
					let leagueDB = db.collection('leagues').doc(league_id)
					leagueDB.get().then((leagueDoc) => {
						if(!leagueDoc.exists){
							msg.reply("the league associated with this server cannot be found.")
						}
						else{
							let playersID = leagueDoc.data().players
							let id = leagueDoc.data().id
							let service = leagueDoc.data().service
							if(id != '' && service != ''){
								updatePlayers(service, id, playersID, 300000, (all_updated)=>{
									if(all_updated){
										msg.reply("data updated.")
										updateRoles(msg)
									}
									else{
										msg.reply("unable to update service data.")
									}
								})
							}
							else{
								msg.reply("the league associated with this server has not been configured to retrieve data.\n\nUse `!league service <service_name> <id>`")
							}
						}
					})
				}
			})
		}
		else{
			msg.reply("please use this command in a server!")
		}
	}
}

function rank_command(msg, message_parts){
	console.log("rank_command")
	let member = msg.author.id
	let guild = msg.guild
	if(guild != null){
		let guild_id = guild.id
		let guildDB = db.collection('guilds').doc(guild_id)
		guildDB.get().then((guildDoc) => {
			if(!guildDoc.exists){
				msg.reply("your server is not initialized with a league!\n\nUse `!league set` to get started!")
			}
			else{
				let league_id = guildDoc.data().league_id
				let leagueDB = db.collection('leagues').doc(league_id)
				leagueDB.get().then((leagueDoc) => {
					if(!leagueDoc.exists){
						msg.reply("the league associated with this server cannot be found.")
					}
					else{
						let membersID = guildDoc.data().members
						let membersDB = db.collection('members').doc(membersID)
						membersDB.get().then((membersDoc)=>{
							let playersID = leagueDoc.data().players
							let playersDB = db.collection('players').doc(playersID)
							playersDB.get().then((playersDoc)=>{
								console.log(message_parts)
								if(message_parts.length > 1){
									//active rank for playername
									let player_name = message_parts.slice(1, message_parts.length).join(" ")
									overallRank(player_name, playersDoc.data(), msg)
								}
								else{
									//active rank for caller
									if(member in membersDoc.data()){
										let player_name = membersDoc.data()[member]
										overallRank(player_name, playersDoc.data(), msg)
									}
									else{
										msg.reply("your tag is not currently set!\n\nUse `!tag <player>` to associate your account with your Smash Tag!")
									}
								}
							})
						})
					}
				})
			}
		})
	}
	else{
		msg.reply("please use this command in a server!")
	}
}

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`)
})

client.on('message', msg => {
	let message_parts = msg.content.split(" ")
	if (message_parts[0] === '!tag'){
		tag_command(msg, message_parts)
	}

	if(message_parts[0] === '!league'){
		league_command(msg, message_parts)
	}

	if(message_parts[0] === '!rank'){
		rank_command(msg, message_parts)
	}

	if (message_parts[0] === '!update'){
		update_command(msg, message_parts)
	}
})


client.login(process.env.BOT_TOKEN)