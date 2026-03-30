# TentaCLAW Theme Pack

## Installation

```bash
# Copy themes to your terminal config
cp -r tentaclaw-themes/* ~/

# For GNOME Terminal
./install-gnome.sh

# For Terminator
./install-terminator.sh

# For iTerm2 (macOS)
# Import from iTerm2 → Preferences → Profiles → Colors → Import
```

## Available Themes

### 1. clawtopus-electric (Default)
The classic cyan + purple + teal theme.

```
Background: #0a0a0f
Foreground: #F0F0F0
Primary:    #00FFFF (Cyan)
Secondary:  #8C00C8 (Purple)
Accent:     #008C8C (Teal)
Success:    #00FF88
Warning:    #FFD700
Error:      #FF4444
```

### 2. clawtopus-midnight
Deep blues with purple accents for night owls.

```
Background: #0d1117
Foreground: #E6EDF3
Primary:    #58A6FF
Secondary:  #8B5CF6
Accent:     #06B6D4
Success:    #3FB950
Warning:    #D29922
Error:      #F85149
```

### 3. clawtopus-matrix
Classic green-on-black for the hacker aesthetic.

```
Background: #000000
Foreground: #00FF00
Primary:    #00FF00
Secondary:  #00CC00
Accent:     #008800
Success:    #00FF00
Warning:    #FFFF00
Error:      #FF0000
```

### 4. clawtopus-fire
Warm oranges and reds for hot GPUs.

```
Background: #1a0a0a
Foreground: #F5F5F5
Primary:    #FF6B35
Secondary:  #FF4444
Accent:     #FF8C00
Success:    #00FF88
Warning:    #FFD700
Error:      #FF0000
```

### 5. clawtopus-ghost
Transparent and spooky.

```
Background: #00000000 (transparent)
Foreground: #E0E0E0
Primary:    #00FFFF
Secondary:  #8C00C8
Accent:     #008C8C
Success:    #00FF88
Warning:    #FFD700
Error:      #FF4444
```

## Quick Switch

```bash
# Switch theme on the fly
source ~/clawtopus-themes/electric.sh
source ~/clawtopus-themes/matrix.sh
source ~/clawtopus-themes/midnight.sh

# Add to your .bashrc for permanent switch
echo "source ~/clawtopus-themes/electric.sh" >> ~/.bashrc
```

## GNOME Terminal One-Liner

```bash
# Apply clawtopus-electric to GNOME Terminal
gsettings set org.gnome.Terminal.ProfilesList default 'clawtopus'
dconf load /org/gnome/terminal/legacy/profiles:/ << EOF
[:]
visible-name='CLAWtopus Electric'
foreground-color='#F0F0F0'
background-color='#0a0a0f'
palette=['#0a0a0f', '#FF4444', '#00FF88', '#FFD700', '#00FFFF', '#8C00C8', '#008C8C', '#F0F0F0', '#333333', '#FF6666', '#66FF99', '#FFEE66', '#66FFFF', '#CC66FF', '#66CCCC', '#FFFFFF']
EOF
```

## Alacritty

Add to `~/.config/alacritty/alacritty.toml`:

```toml
[theme.clawtopus]
primary = { primary = "#00FFFF", secondary = "#8C00C8" }
background = "#0a0a0f"
foreground = "#F0F0F0"
```

## iTerm2 Colors

Import `clawtopus-electric.itermcolors`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Ansi 0 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0.039</real><key>Green Component</key><real>0.039</real><key>Blue Component</key><real>0.059</real></dict>
    <key>Ansi 1 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>1</real><key>Green Component</key><real>0.267</real><key>Blue Component</key><real>0.267</real></dict>
    <key>Ansi 2 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0</real><key>Green Component</key><real>1</real><key>Blue Component</key><real>0.533</real></dict>
    <key>Ansi 3 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>1</real><key>Green Component</key><real>0.843</real><key>Blue Component</key><real>0</real></dict>
    <key>Ansi 4 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0</real><key>Green Component</key><real>1</real><key>Blue Component</key><real>1</real></dict>
    <key>Ansi 5 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0.549</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0.784</real></dict>
    <key>Ansi 6 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0</real><key>Green Component</key><real>0.549</real><key>Blue Component</key><real>0.549</real></dict>
    <key>Ansi 7 Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0.941</real><key>Green Component</key><real>0.941</real><key>Blue Component</key><real>0.941</real></dict>
    <key>Background Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0.039</real><key>Green Component</key><real>0.039</real><key>Blue Component</key><real>0.059</real></dict>
    <key>Foreground Color</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>0.941</real><key>Green Component</key><real>0.941</real><key>Blue Component</key><real>0.941</real></dict>
</dict>
</plist>
```

---

*Theme your terminal. Theme your cluster. Theme your life.*
