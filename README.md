# rankBot

A bot to retrieve data from Power Ranking services (currently Braacket.com) to use in Discord servers.

## Features
1. Discord server members can claim a player name on the pr
2. rankBot can assign roles based on the percentile a player is ranked on the pr
3. Discord server members can easily find out their current stats (currently rank)

## Getting Started

These instructions will get rankBot up and running on your own discord server.

### Prerequisites

1. [Add rankBot to your server](https://discordapp.com/api/oauth2/authorize?client_id=547545067796299786&permissions=268435456&scope=bot)

2. move rankBot's role above the roles you want rankBot to utilize

3. move rankBot's role below the roles you want to be able to modify rankBot's settings


### Setting up a league

By default, your server will not be associated with a league of players. You can either add an existing league or create a new one!

The process is the same.

```
!league set <league_id>
```

If you are not the owner of this league, then you will have to rely on the owner and their mods to setup the rest for you. However, if you are the owner, you will need to set up a service to retrieve data with.

```
!league service braacket <braacket_id>
```

That's all that's required to start pulling data! To fill your league's database with the current ranking data use `league update`.

```
!league update
```

If you want to PERMANENTLY delete your league to free up the league_id, use `league delete`

```
!league delete
```

### Managing Discord Members' tags

At any time, a discord server member can add associate a player name with their account by using `tag`.

```
!tag <player name>
```

Once a member's tag has been set, they can call `rank` to see their current ranking.

```
!rank
```

To see the rank of a specific player, add the `player name` argument.

```
!rank <player name>
```

Tags are unique for server members, so members won't be able to claim a tag that another member has already claimed.

Tags can be unclaimed in two ways.

1. Any user can unclaim themselves.

```
!tag unlink
```

2. A server mod can unclaim a player name.

```
!tag unlink <player name>
```

### Adding roles to a league

If you want to have your members' role reflect their ranking data, you will need to setup new role rules for your league!

To make a role rule, you need three parts.

1. A role name
2. A perctile (a fraction that represents a percentage the league's max score)
3. `true` or `false`, depending on whether a player needs to be active on the pr to have this role.

```
!league ranks add <role name> <percentile> <true/false>
```

Role rules will automatically be ordered by percentile and whether they require a player to be active.

Roles can also be removed using `league ranks remove`

```
!league ranks remove <role name>
```

Once you have your role rules to your liking, you can call `league ranks update` to update the roles of all members who have claimed a tag.

```
!league ranks update
```

Claiming and unclaiming tags will automatically update that individual's role, but players can update their role anytime using `rank update`

```
!rank update
```

### Adding mods to your league

If you want other discord users to be able to modify the sensitive settings in your league, you can add mods to your league using `league mod add`

```
!league mod add @Member
```

To unmod a member, the owner or any mod can call `league mod remove`

```
!league mod remove @Member
```

## Built With

* [discord.js](https://discord.js.org) - Used to talk easily with discord
* [cheerio](https://cheerio.js.org/) - Used to read html data
* [firebase](https://firebase.google.com/) - Used to store user data

## Authors

* **Drew Dearing** - *developer* - [drewdearing](https://github.com/drewdearing)
