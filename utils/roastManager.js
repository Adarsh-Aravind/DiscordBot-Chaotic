// Roast pool + a "shuffle bag" picker so the same roast never comes back
// until the whole list has been used up.

const roasts = [
    // --- classics, refreshed ---
    "You're not useless. You make a great bad example.",
    "I'd agree with you, but then we'd both be wrong.",
    "You have the confidence of a man who has never once been correct.",
    "Somewhere a tree is working overtime to replace the oxygen you waste. Apologize to it.",
    "I'd explain it to you, but I ran out of crayons.",
    "You bring everyone so much joy. Right after you leave.",
    "You're the reason the shampoo bottle has instructions.",
    "You have your whole life to be like this. Why not take today off?",
    "You're the human equivalent of a participation trophy.",
    "You're not the dumbest person alive, but you'd better hope they stay healthy.",
    "Your secrets are safe with me. I never listen when you talk.",
    "I'm not saying you're slow. I'm saying light gets bored waiting for you.",
    "You're proof that evolution takes breaks.",
    "If I wanted to hear from something with no brain, I'd shake a coconut.",
    "You have the personality of an unseasoned boiled potato.",
    "I've met bricks with better follow-through.",
    "You're the plot hole in your own life story.",
    "Every group has that one guy. Take a guess.",
    "You're like a software update. Nobody asked, and everything's worse now.",
    "You peaked in a group photo you weren't centered in.",

    // --- online / discord life ---
    "You type 'hey' and then nothing. You're a crime against conversation.",
    "You're the guy who joins VC, says nothing for two hours, and leaves.",
    "Your Spotify Wrapped is a cry for help.",
    "Your screen time report has been forwarded to the authorities.",
    "You laugh-react to your own messages. We see it.",
    "You've been 'about to go to sleep' for six hours.",
    "Nobody has ever finished reading one of your messages.",
    "You send voice notes. In 2026. Unprompted.",
    "Your profile picture has been the same since you had hope.",
    "You reply 'lol' to things that were genuinely important.",
    "You're the reason this server has rules.",
    "You'd lose an argument to an auto-reply.",
    "You type like the keyboard owes you money.",
    "Your camera stays off for a reason and we all respect it.",
    "You're online 14 hours a day and still miss every single ping.",
    "You use three dots at the end of every message like a threat you can't follow through on.",

    // --- gaming ---
    "Your aim is a rumor. Nobody's confirmed it.",
    "You play like the tutorial gave up on you.",
    "You have 900 hours and the game knowledge of a fresh install.",
    "You're the reason the surrender vote exists.",
    "Your KD is a fraction in the way a papercut is surgery.",
    "You call it a playstyle. The rest of us call it a liability.",
    "You've never won a fight you started.",
    "Your callouts are just screaming with extra steps.",
    "You bought the battle pass and still can't finish a match.",
    "You're the fifth player in a four-man stack.",
    "Bots leave the lobby when you queue.",
    "You blame the ping. The ping blames you.",
    "You clutch once a year and won't shut up for the other 364 days.",
    "You die first and spectate loudest.",

    // --- self-own reversals ---
    "I'd roast you properly, but my mom raised me to be kind to the less fortunate.",
    "I'd insult you, but you've clearly been doing that yourself for years.",
    "I was going to be mean, but you looked so proud of yourself.",
    "I'd tell you to touch grass, but the grass has boundaries.",
    "I'd say you're one in a million, but the odds are worse than that.",
    "I could roast you, but nature already handled it.",
    "You're doing your best. That's the tragic part.",
    "Honestly? Good for you. Genuinely. That's the roast.",

    // --- absurd / surreal ---
    "You look like you'd lose a staring contest to a mirror.",
    "You have the aura of a printer that only works on Tuesdays.",
    "You're the sound of a chair scraping, but as a person.",
    "You're what happens when a group project has no leader.",
    "You give off unattended-gas-station-hotdog energy.",
    "You look like a stock photo of disappointment.",
    "You're the human version of a 2% battery warning.",
    "You have the structural integrity of a wet paper straw.",
    "You're the third option nobody clicks.",
    "You're what a scam email is going for.",
    "You're the extra key on the keyring that opens nothing.",
    "You have the presence of an elevator that skips your floor.",
    "You're the smell of a laptop fan working too hard.",
    "You'd get lost in a hallway.",
    "You're a loading screen with no game behind it.",
    "You have the vibe of a Wikipedia article marked 'citation needed'.",
    "You're the pop-up ad of people.",
    "You're a group chat nobody's muted yet, but it's coming.",

    // --- competence ---
    "You'd find a way to lose a coin flip you called both sides of.",
    "You've failed at things that don't have a fail state.",
    "You give advice like a man reading a map upside down.",
    "You couldn't organize a one-man queue.",
    "You've never once been early to anything, including your own point.",
    "You start every project at 95% confidence and 0% competence.",
    "You'd break a rock by handling it.",
    "You have opinions the way a broken tap has water. Constantly and unwanted.",
    "You'd argue with a calculator and lose on principle.",
    "You've been wrong so consistently it's almost a skill.",
    "You explain simple things badly and complicated things worse.",
    "You'd overthink a coin toss and still get it wrong.",
    "Watching you make a decision is a spectator sport nobody bought tickets for.",

    // --- affectionate-mean, friend-group flavored ---
    "We keep you around for legal reasons.",
    "You're everyone's fourth favorite friend and you know exactly why.",
    "You're invited to things out of habit, not desire.",
    "You're the friend the story is about, never the one telling it.",
    "Every group needs a cautionary tale. Thank you for volunteering.",
    "You're beloved in the way a broken chair is beloved. Nostalgia, mostly.",
    "You're the reason we have a second group chat.",
    "You've never picked a restaurant in your life and you never will.",
    "You're the one who says 'I'm down for whatever' and then isn't.",
    "You've been carried socially since birth and it shows.",
    "You'd be the first one voted off and you'd be shocked.",
    "You're a good person, which is lucky, because that's all you've got."
];

// One shuffled queue per key (per guild), so two servers don't fight over
// the same sequence. Nothing repeats until the pool is exhausted.
const bags = new Map();
const lastServed = new Map();

function shuffled(length) {
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

module.exports = {
    /**
     * Get a roast, guaranteed not to repeat until every roast has been used.
     * @param {string} [key] Scope for the no-repeat queue, usually a guild id.
     * @returns {string} The roast
     */
    getRandomRoast(key = 'global') {
        let bag = bags.get(key);

        if (!bag || bag.length === 0) {
            bag = shuffled(roasts.length);
            // Don't let a fresh queue open with the roast we just used.
            if (bag.length > 1 && bag[bag.length - 1] === lastServed.get(key)) {
                [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
            }
            bags.set(key, bag);
        }

        const index = bag.pop();
        lastServed.set(key, index);
        return roasts[index];
    },

    /** Total roasts in the pool. */
    get size() {
        return roasts.length;
    }
};
