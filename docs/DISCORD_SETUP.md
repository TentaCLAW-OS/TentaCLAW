# TentaCLAW OS Discord Server Setup Guide

## Overview

This guide helps you set up "The Tank" - the official TentaCLAW OS Discord server community hub.

**Server Name**: The Tank  
**Purpose**: Community support, showcase, announcements, and fun for TentaCLAW OS users.

---

## Step 1: Create the Discord Server

1. Open Discord → Click the "+" icon (left sidebar)
2. Choose "Create My Own" → "For a club or community"
3. Server Name: `The Tank`
4. Upload a server icon (use CLAWtopus logo from BRAND.md)
5. Set region to closest to your community

---

## Step 2: Channel Structure

### Required Channels

```
# 📢 announcements    - #1 for TentaCLAW OS updates
# 🎉 welcome          - New member greetings
# 💬 general          - General discussion
# 🆘 support          - Help with setup/installation
# 📸 showcase         - Show off your rigs
# 🐛 bugs             - Bug reports
# 💡 ideas            - Feature requests
```

### Fun Channels

```
# 🎭 off-topic        - Random discussions
# 🤖 bot-commands     - Bot command spam
# 🎨 art              - CLAWtopus fan art
# 📰 latest-memes     - AI/hardware memes
```

### Private Channels (create as needed)

```
# 🏠 homelab          - For homelab setups
# 🏢 enterprise       - For enterprise deployments
# 🔬 dev-talk         - Developer discussions
```

---

## Step 3: Roles

### Auto-Assigned Roles

| Role | Color | Who Gets It | Permissions |
|------|-------|-------------|-------------|
| @TentaCLAW Newcomer | Gray | New members | Read channels, react |
| @TentaCLAW User | Cyan | Verified users | + send messages |
| @TentaCLAW Installer | Purple | Completed install | + embed links |
| @CLAWtopus Fan | Teal | 10+ messages | + attach files |

### Staff Roles

| Role | Color | Permissions |
|------|-------|-------------|
| @Tank Commander | Red | Admin everything |
| @OctoHelper | Green | Manage messages, pins |
| @Veteran | Gold | Access #veterans channel |

---

## Step 4: Bot Setup

### CLAWtopus Bot Commands

Create a bot user at https://discord.com/developers/applications

```python
# bot.py - Simple CLAWtopus Discord bot example
import discord
import asyncio

intents = discord.Intents.default()
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f'CLAWtopus is online as {client.user}')
    # Set status
    await client.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching,
            name="8 GPUs being awesome"
        )
    )

@client.event
async def on_message(message):
    if message.content.startswith('!clawtopus'):
        await message.channel.send("🐙 CLAWTOPUS SAYS: Hello! I'm watching your GPUs!")
    elif message.content.startswith('!rig'):
        await message.channel.send("🐙 Checking your rig... All tentacles operational!")
    elif message.content.startswith('!joke'):
        jokes = [
            "Why did the CLAWtopus cross the network? To get to the other side of the GPU!",
            "How many GPUs does it take to run a CLAWtopus? Eight. Always eight.",
        ]
        import random
        await message.channel.send(random.choice(jokes))
    elif message.content.startswith('!help'):
        await message.channel.send("""
**CLAWtopus Bot Commands:**
`!clawtopus` - Get a greeting
`!rig` - Check rig status  
`!joke` - Hear a terrible pun
`!ascii` - Get CLAWtopus ASCII art
`!stats` - Show server stats
`!invite` - Get invite link
        """)

client.run('YOUR_BOT_TOKEN')
```

### Useful Bots to Add

| Bot | Purpose | Invite Link |
|-----|---------|-------------|
| MEE6 | Auto roles, moderation | mee6.gg |
| Dyno | Moderation, auto-mod | dyno.gg |
| Carl-bot | Custom commands, logs | carl.gg |
| Statbot | Server stats | statbot.net |

---

## Step 5: Server Settings

### Enable Community Features
1. Server Settings → Enable Community
2. Check "Safe Direct Messaging"
3. Enable "Discovery"
4. Set onboarding channel

### Configure Auto-Moderation
```
Server Settings → AutoMod
- Block spam messages
- Block harmful links
- Filter profanity (or don't, we're not that formal)
```

### Welcome Screen
```
Server Settings → Welcome Screen
Enable: Yes
Welcome Channel: #welcome
Description: Welcome to The Tank! Home of TentaCLAW OS and CLAWtopus enthusiasts!
```

---

## Step 6: Custom Emojis

Add these emoji to the server:

```
🐙 - CLAWtopus (main mascot)
💜 - Purple (brand)
💠 - Cyan (brand)
🟣 - Deep purple
🦑 - Octopus variant
⚡ - Electric theme
🔥 - Fire/meme
🎉 - Celebration
🆘 - Support
📊 - Stats
💾 - Storage
🖥️ - Rig/computer
🌐 - Network/web
🔧 - Tools
⭐ - Star/favorite
🏆 - Achievement
```

---

## Step 7: Integrations

### Webhook for GitHub
```
# GitHub → Settings → Webhooks → Add webhook
# Payload URL: Your Discord webhook URL
# Events: Push, Release, Pull requests
```

### Webhook for CI/CD
```
# GitHub Actions or GitLab CI can post to #announcements
```

### API for Bot
```
# Reserve #bot-commands for bot spam
# Set slowmode if needed
```

---

## Step 8: Branding

### Server Banner
- Use the gradient banner from BRAND.md
- Colors: Cyan #00FFFF, Purple #8C00C8, Teal #008C8C

### Rules (copy/paste to #rules)

```
═══════════════════════════════════════
         🐙 WELCOME TO THE TANK 🐙
═══════════════════════════════════════

1. Be excellent to each other
2. No spam or self-promotion
3. Keep it legal
4. Don't ask to ask, just ask
5. Pictures of rigs welcome!
6. Memes encouraged
7. Be cool like CLAWtopus

═══════════════════════════════════════
```

### MOTD (Message of the Day)
```
Welcome to The Tank!
8 GPUs, 8 tentacles, infinite possibilities.
Type !help in #🤖-bot-commands to see available commands.
```

---

## Step 9: nitro Banner (Optional)

When you have nitro, enable server banner:
```
Server Settings → Server Banner & Frame
Upload gradient banner image
```

---

## Launch Checklist

- [ ] Created "The Tank" server
- [ ] Set up all channels
- [ ] Configured roles
- [ ] Added CLAWtopus bot
- [ ] Added useful bots (MEE6, Dyno, etc.)
- [ ] Uploaded custom emoji
- [ ] Configured welcome screen
- [ ] Set up GitHub webhook (for updates)
- [ ] Posted rules
- [ ] Invited beta testers

---

## Invite Link Setup

After setup, create a permanent invite:
```
Channel Settings → Invite → Create Invite
Max Age: Never
Max Uses: Unlimited
Temp Invite: Disabled
```

---

## Support

Need help? Open an issue at:
https://github.com/TentaCLAW-OS/TentaCLAW-OS/issues

---

*Welcome to The Tank, where every rig is a feature, and every GPU is a friend.*

🐙 ** tentacles ready** 🐙
