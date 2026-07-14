# Renders docs/demo.gif — run:  vhs demo.tape
# Install vhs: https://github.com/charmbracelet/vhs

Output docs/demo.gif

Set Shell "bash"
Set FontSize 21
Set Width 1120
Set Height 620
Set Padding 28
Set TypingSpeed 0ms
Set Theme { "name": "praxis", "background": "#0a1214", "foreground": "#e9f1ef", "cursor": "#e0668c", "selection": "#15282c", "black": "#0a1214", "red": "#e85a4f", "green": "#42c193", "yellow": "#ecc65f", "blue": "#54a2e6", "magenta": "#e0668c", "cyan": "#54a2e6", "white": "#e9f1ef", "brightBlack": "#6a8382", "brightRed": "#e85a4f", "brightGreen": "#42c193", "brightYellow": "#ecc65f", "brightBlue": "#54a2e6", "brightMagenta": "#e0668c", "brightCyan": "#54a2e6", "brightWhite": "#ffffff" }

Hide
Type "clear" Enter
Show

Type "node scripts/demo.mjs" Enter
Sleep 15s
