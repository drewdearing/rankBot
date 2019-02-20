require('dotenv').config()

const Discord = require('discord.js')
const fs = require('fs')
const request = require('request')
const cheerio = require('cheerio')
const client = new Discord.Client()
let members = {}
let players = {}
let max_points = 0

const ranks = {
	"Diamond": 0.995,
	"Platinum": 0.95,
	"Gold": 0.75,
	"Silver": 0.4,
	"Bronze": 0,
	"Unranked": 0
}

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`)
})

function newTagRole(member, msg){
	let guild = msg.guild
	if(member in members && guild != null){
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

function updatePlayerData(retries, temp_players, callback){
	for(player_name in temp_players){
		let player = temp_players[player_name]
		if(!player.updated){
			request(player.url, {json: false}, (err, res, body) => {
				const $ = cheerio.load(body)
				let dashboard_values = $("div.panel-body").find("div.my-dashboard-values-sub")
				if(dashboard_values.length > 0){
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
				}
				else{
					if(player_name in players){
						player.points = players[player_name].points
						player.active = players[player_name].active
					}
				}

				player.finished = true
				let all_finished = true
				for(p in temp_players){
					if(temp_players[p].finished == false){
						all_finished = false
						break
					}
				}
				if(all_finished){
					let all_updated = true
					for(p in temp_players){
						if(temp_players[p].updated == false){
							all_updated = false
							break
						}
					}
					if(all_updated || retries == 0){
						players = temp_players
						callback(all_updated)
					}
					else{
						for(p in temp_players){
							temp_players[p].finished = false
						}
						updatePlayerData(retries-1, temp_players, callback)
					}
				}
			})
		}
		else{
			player.finished = true
		}
	}
}

function updatePlayers(retries, callback){
	temp_players = {}
	request('https://braacket.com/league/ResurrectedUltimate/player?rows=200', { json: false }, (err, res, body) => {
		const $ = cheerio.load(body)
		let player_fields = $('table.table.table-hover.my-table-checkbox')

		if (err || player_fields.length <= 0) {
			if(retries == 0){
				for(player_name in players){
					players[player_name].updated = false
				}
				callback(false)
			}
			else{
				updatePlayers(retries - 1, callback)
			}
		}
		else{
			player_fields.find('tbody').find('a').each(function(i, elem){
				temp_players[$(this).text()] = {
					"name": $(this).text(),
					"points": undefined,
					"active": false,
					"url": "https://braacket.com" + $(this).attr('href'),
					"updated": false,
					"finished": false
				}
			})

			updatePlayerData(10, temp_players, callback)
		}
	});
}



client.on('message', msg => {
	let message_parts = msg.content.split(" ")
	let member = msg.author.id
	if (message_parts[0] === '!tag') {
		if(message_parts.length > 1){
			let tag = message_parts.slice(1, message_parts.length).join(" ")
			members[member] = tag
			msg.reply("tag set!")
			newTagRole(member, msg)
		}
		else{
			if(member in members){
				msg.reply("your tag is currently set to "+members[member])
			}
			else{
				msg.reply("your tag is not currently set!\n\nUse `!tag <player>` to associate your account with your Smash Tag!")
			}
		}
	}

	if (message_parts[0] === '!update') {
		if(message_parts.length == 1){
			updatePlayers(10, (all_updated)=>{
				if(all_updated){
					msg.reply("data updated.")
					updateRoles(msg)
				}
				else{
					let m = "unable to update data for "
					let un_updated = new Array()
					for(p in players){
						if(!players[p].updated){
							un_updated.push(p)
						}
					}
					m += un_updated.join(", ") + "."
					msg.reply(m)
				}
			})
		}
	}
})

client.on('guildMemberAdd', member => {
	if (!(member.user.id in members)){
		member.send('welcome to Resurrected Smash! Use !tag <player name> to associate your account with your Smash Tag!')
	}
	else{
		member.send('welcome back!')
	}
})

client.login(process.env.BOT_TOKEN)