#!/bin/bash
# tentaclaw-jokes.sh - CLAWtopus jokes and fun facts
# Because AI inference should be fun!

source "$(dirname "${BASH_SOURCE[0]}")/clawtopus.sh"

TENTACLAW_JOKES=(
    "Why did the CLAWtopus cross the network?\n  To get to the other side of the GPU!"
    "How many GPUs does it take to run a CLAWtopus?\n  Eight. Always eight."
    "Why don't CLAWtopus make good comedians?\n  They always steal the show AND the compute!"
    "What's a CLAWtopus' favorite model?\n  Anything that fits in VRAM!"
    "Why did the neural network fail?\n  It didn't have enough tentacles to process!"
    "How does CLAWtopus parallelize?\n  With eight processes simultaneously!"
    "Why are GPUs like CLAWtopus?\n  Both have tons of cores and never sleep!"
    "What do you call a CLAWtopus with no GPUs?\n  A calamari upgrade!"
    "Why did the rig run hot?\n  CLAWtopus was warming up for inference!"
    "What's CLAWtopus' favorite programming language?\n  Python. Slither into it!"
)

TENTACLAW_FACTS=(
    "CLAWtopus has 8 arms, just like your 8-GPU rig!"
    "Octopuses have 3 hearts. CLAWtopus has 3x redundancy."
    "CLAWtopus can edit RNA in real-time. Like your model!"
    "An octopus has distributed intelligence - each arm thinks independently!"
    "CLAWtopus never forgets - just like your inference cache!"
    "Octopuses can squeeze through any gap - CLAWtopus squeezes through firewalls!"
    "CLAWtopus has blue blood - just like liquid-cooled GPU rigs!"
    "Octopuses have been around 300 million years - CLAWtopus has been cool for 3 days!"
    "CLAWtopus can change color instantly - like your power profile!"
    "A CLAWtopus has 240 years of collective wisdom in each tentacle!"
)

get_tentaclaw_joke() {
    local index=$((RANDOM % ${#TENTACLAW_JOKES[@]}))
    echo -e "${TENTACLAW_JOKES[$index]}"
}

get_tentaclaw_fact() {
    local index=$((RANDOM % ${#TENTACLAW_FACTS[@]}))
    echo -e "${TENTACLAW_FACTS[$index]}"
}

fortune_tentaclaw() {
    local roll=$((RANDOM % 100))
    
    if [ $roll -lt 40 ]; then
        echo ""
        clawtopus_say "Here's a good one..."
        echo ""
        get_tentaclaw_joke
    elif [ $roll -lt 80 ]; then
        echo ""
        clawtopus_say "Did you know..."
        echo ""
        get_tentaclaw_fact
    else
        echo ""
        clawtopus_say "Your fortune today:"
        echo ""
        fortune -s 2>/dev/null || echo "Today is a good day to run inference!"
    fi
    echo ""
}

case "${1:-fortune}" in
    joke)
        get_tentaclaw_joke
        ;;
    fact)
        get_tentaclaw_fact
        ;;
    fortune)
        fortune_tentaclaw
        ;;
    *)
        echo "Usage: $0 {joke|fact|fortune}"
        exit 1
        ;;
esac
