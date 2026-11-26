"""Made-up multi-speaker scenes for the voice bench. Every name and line is invented.

Each scene has the phone's owner ("me", always the same voice) and 1-4 other people, and two
conversations: "a" (people introduce themselves or are introduced) and "b" (a later chat with the
same people, after every other scene's first conversation). Voices: ("k", id) is a Kokoro v1.0
voice (Apache-2.0), ("p", id) a Piper LibriTTS-R speaker (MIT model, CC BY 4.0 data).

"role" is what each person is, as Sidekick should describe them while their name isn't known
(alternatives split by "|"). People with no name must be shown by their role.
"""

OWNER = {"name": "Me", "voice": ("k", 16)}  # am_michael

# Wake-word questions that teach the owner's voice before any scene (the app's normal path).
OWNER_QUESTIONS = [
    "Hey Sidekick, what's the weather going to be like this afternoon?",
    "Hey Sidekick, remind me to call the garage about the brakes tomorrow morning.",
    "Hey Sidekick, how long does it take to boil an egg properly?",
    "Hey Sidekick, what did I say I needed to buy for the weekend?",
]

SCENES = [
    {
        "id": "bookclub",
        "people": {
            "priya": {"name": "Priya", "role": "book club member", "voice": ("k", 2)},  # af_bella
            "tomasz": {"name": "Tomasz", "role": "neighbour", "voice": ("p", 120)},
        },
        "a": [
            ("me", "Hello, come in, the others are already in the kitchen."),
            ("priya", "Hi, I'm Priya, nice to meet you. Sorry I'm a bit late, the bus was slow."),
            ("me", "No problem at all. Can I get you something to drink?"),
            ("priya", "Just water for now, thank you."),
            ("tomasz", "Hello, my name is Tomasz. I live two doors down, at number fourteen."),
            ("priya", "Oh lovely. Did you both finish the book this month?"),
            ("tomasz", "I did, but the ending was a little disappointing if I'm honest."),
            ("me", "I agree. The middle part about the lighthouse was the best bit."),
            ("priya", "Yeah."),
            ("tomasz", "Priya, what did you think of the sister? I couldn't stand her."),
            ("priya", "I actually liked her. She was the only one who told the truth about the farm."),
            ("me", "That's a good point. Shall we pick the next book before we forget?"),
            ("tomasz", "Sure."),
            ("priya", "I'd vote for something shorter. Maybe under three hundred pages this time."),
        ],
        "b": [
            ("tomasz", "Evening. I brought biscuits, the ones with the orange in them."),
            ("me", "Perfect, thanks Tomasz. Put them on the table by the window."),
            ("priya", "I only got halfway through this one, I've been working late all week."),
            ("me", "That's fine, we won't spoil the ending for you."),
            ("tomasz", "The chapter in the hospital was very well written though."),
            ("priya", "Okay."),
            ("priya", "Can we meet on the second Thursday next month instead of the first?"),
            ("tomasz", "That works for me. I'm away on the first anyway."),
        ],
    },
    {
        "id": "flat",
        "people": {
            "ines": {"name": "Ines", "role": "flatmate", "voice": ("k", 21)},  # bf_emma
            "okello": {"name": "Okello", "role": "flatmate", "voice": ("k", 14)},  # am_fenrir
            "ruth": {"name": "Ruth", "role": "flatmate", "voice": ("p", 300)},
        },
        "a": [
            ("ines", "Hiya, I'm Ines, I'm the new flatmate. I moved into the back room on Sunday."),
            ("me", "Welcome. The bins go out on Tuesday night, that's the main rule."),
            ("okello", "Hello Ines, my name's Okello. I'm usually up very early for work, sorry in advance."),
            ("ines", "That's fine, I sleep through anything."),
            ("ruth", "And I'm Ruth, nice to meet you. I'm the one who keeps buying too much milk."),
            ("ines", "Ha, good to know. Is there a rota for the cleaning?"),
            ("okello", "There's a sheet on the fridge. We swap every week on Monday."),
            ("ruth", "Okello, can you show her how the boiler works? It's a bit strange."),
            ("okello", "Yes, of course. You have to press the red button twice and then wait."),
            ("me", "And never put the heating above twenty, the bill last winter was huge."),
            ("ines", "Got it. Thanks, Ruth."),
            ("ruth", "No worries."),
        ],
        "b": [
            ("okello", "Someone left the back door open again last night."),
            ("ruth", "That was me, I'm really sorry. I was taking the recycling out."),
            ("ines", "It's okay. Did anyone see a parcel for me? It was meant to come yesterday."),
            ("me", "I think the neighbour took it in. Ruth, did you see a note?"),
            ("ruth", "Yes, it's on the shelf by the stairs. A small brown one."),
            ("okello", "Also the washing machine is making that noise again."),
            ("ines", "I'll ring the landlord tomorrow morning about it."),
            ("me", "Great, thanks."),
        ],
    },
    {
        "id": "meeting",
        "people": {
            # bm_george and bm_daniel are the two most similar voices in the set (cosine 0.67).
            "hal": {"name": "Hal", "role": "colleague", "voice": ("k", 26)},
            "dev": {"name": "Dev", "role": "colleague", "voice": ("k", 24)},
            "yara": {"name": "Yara", "role": "colleague", "voice": ("k", 9)},  # af_sarah
            "lukas": {"name": "Lukas", "role": "colleague", "voice": ("p", 50)},
        },
        "a": [
            ("hal", "Right, let's start. For anyone new, my name is Hal and I look after the warehouse team."),
            ("dev", "Hi, I'm Dev, nice to meet you all. I joined the planning team last week."),
            ("yara", "Hello, I'm Yara. I run the delivery drivers on the north routes."),
            ("lukas", "And I'm Lukas, I'm covering the evening shift until the end of March."),
            ("me", "Thanks everyone. The main thing today is the late orders from last Friday."),
            ("hal", "We had two lorries stuck on the ring road for almost three hours."),
            ("yara", "My drivers didn't get the new addresses until after lunch."),
            ("me", "Dev, can you look at why the addresses went out so late?"),
            ("dev", "Yes, I'll check the system logs this afternoon and send a note round."),
            ("lukas", "Mm."),
            ("hal", "We should also order more pallets before the holiday rush starts."),
            ("me", "Agreed. Lukas, what do you need for the evening shift?"),
            ("lukas", "Two more people on Thursdays would make a real difference."),
            ("yara", "I can lend you one of mine on Thursdays if that helps."),
        ],
        "b": [
            ("me", "Quick update meeting. Dev, did you find out what happened with the addresses?"),
            ("dev", "Yes. The export job was stuck behind the monthly report. It's fixed now."),
            ("hal", "Good. The pallets arrived this morning, forty of them."),
            ("yara", "The north routes were all on time this week, every single day."),
            ("lukas", "The extra person on Thursday helped a lot, thanks Yara."),
            ("yara", "No problem."),
            ("hal", "Next week I'm off on Wednesday, so Dev will cover the warehouse call."),
            ("dev", "Okay, send me the list of things to check before then."),
        ],
    },
    {
        "id": "neighbours",
        "people": {
            "mara": {"name": "Mara", "role": "neighbour", "voice": ("k", 6)},  # af_nicole
            "bram": {"name": "Bram", "role": "neighbour", "voice": ("k", 13)},  # am_eric
        },
        "a": [
            ("mara", "Excuse me, sorry to bother you. My name's Mara, we've just moved in next door."),
            ("me", "Oh hello, welcome to the street. How are you settling in?"),
            ("mara", "Slowly. There are boxes everywhere. This is my husband, by the way."),
            ("bram", "Hi there, I'm Bram. Nice to meet you."),
            ("me", "Nice to meet you both. If you need anything, just knock."),
            ("bram", "Actually, do you know which day the garden waste gets collected?"),
            ("me", "Every other Wednesday. The brown bin, not the green one."),
            ("mara", "Thank you, that's really helpful. We had no idea."),
            ("bram", "Cheers."),
        ],
        "b": [
            ("bram", "Morning! Your hedge is looking very tidy."),
            ("me", "Thanks Bram. I finally had a free Saturday."),
            ("mara", "We're having a few people round on Sunday afternoon, you'd be very welcome."),
            ("me", "That's kind, Mara. What time should I come?"),
            ("mara", "Any time after three. Just bring yourself."),
            ("bram", "And maybe a folding chair if you have one, we're a bit short."),
            ("me", "Sure, I've got two in the shed."),
        ],
    },
    {
        "id": "cafe",
        "people": {
            "zofia": {"name": "Zofia", "role": "flatmate", "voice": ("k", 23)},  # bf_lily
            "waiter": {"name": None, "role": "waiter|server", "voice": ("p", 700)},
        },
        "a": [
            ("zofia", "Hi, sorry, I'm Zofia, we spoke on the phone about the flat. Nice to meet you properly."),
            ("me", "Hi Zofia, nice to meet you too. Have a seat."),
            ("waiter", "Good afternoon, are you ready to order or do you need a few minutes?"),
            ("zofia", "Could I have a pot of tea and a cheese scone, please?"),
            ("me", "And a flat white for me, thanks."),
            ("waiter", "Of course. Would you like anything else, maybe a slice of cake?"),
            ("me", "No, that's all, thank you."),
            ("zofia", "So the room is available from the first of next month?"),
            ("me", "Yes, the current tenant moves out on the twenty eighth."),
            ("waiter", "Here you go, one tea, one scone and a flat white. Enjoy."),
            ("zofia", "Thanks."),
        ],
        "b": [
            ("zofia", "Thanks for meeting again. I've signed the forms, they're in this envelope."),
            ("me", "Brilliant. I'll drop them at the agency on Monday."),
            ("waiter", "Hello again, what can I get you both today?"),
            ("zofia", "Same as last time please, the tea and a scone."),
            ("me", "Just a glass of water for me today."),
            ("zofia", "Do you know if the landlord allows bikes in the hallway?"),
            ("me", "Yes, as long as they don't block the stairs."),
        ],
    },
    {
        "id": "club",
        "people": {
            "callum": {"name": "Callum", "role": "coach", "voice": ("k", 15)},  # am_liam
            "femi": {"name": "Femi", "role": "player", "voice": ("p", 900)},
            "nadia": {"name": "Nadia", "role": "player", "voice": ("k", 5)},  # af_kore
        },
        "a": [
            ("callum", "Okay everyone, gather round. I'm Callum, I'll be coaching the Tuesday group."),
            ("femi", "Hello, my name is Femi. I've played before but not for about ten years."),
            ("nadia", "Hi, I'm Nadia. I'm completely new, so please be patient with me."),
            ("callum", "No problem. Femi, could you help Nadia with the warm up drills?"),
            ("femi", "Yeah, happy to. Start with the short passes, Nadia, nice and gentle."),
            ("nadia", "Like this? It keeps rolling off to the left."),
            ("femi", "Turn your foot a bit more. That's it, much better."),
            ("me", "Callum, what time do we usually finish on Tuesdays?"),
            ("callum", "Half past eight, then the hall is booked for badminton."),
            ("nadia", "Thank you, Femi."),
            ("femi", "Any time."),
        ],
        "b": [
            ("callum", "Good turnout tonight. We'll do a short match at the end."),
            ("nadia", "I've been practising in the park every morning this week."),
            ("femi", "It shows, your passing is much more accurate already."),
            ("me", "Callum, are we still going to the tournament in May?"),
            ("callum", "Yes, I've put our names down. It's in the sports centre by the river."),
            ("nadia", "Will we need our own shirts for that?"),
            ("callum", "No, the club will order them. Just tell me your size by Friday."),
            ("femi", "Medium for me, please."),
        ],
    },
    {
        "id": "family",
        "people": {
            "greta": {"name": "Greta", "role": "family", "voice": ("k", 20)},  # bf_alice
            "rafi": {"name": "Rafi", "role": "family", "voice": ("k", 18)},  # am_puck
            "elsie": {"name": "Elsie", "role": "family", "voice": ("p", 10)},
        },
        "a": [
            ("greta", "Dinner's ready, everyone sit down before it gets cold."),
            ("rafi", "Thanks Greta, it smells amazing. Is that the lemon chicken?"),
            ("greta", "It is. Rafi, can you pass the potatoes down to Elsie?"),
            ("rafi", "Here you go."),
            ("elsie", "Thank you. I'm Elsie by the way, I don't think we've met. I'm Greta's niece."),
            ("me", "Nice to meet you Elsie. How do you know Rafi?"),
            ("elsie", "We were at university together, a very long time ago now."),
            ("rafi", "Not that long ago, don't make me feel old."),
            ("greta", "There's apple crumble for afterwards, if anyone has room."),
            ("me", "Always room for crumble."),
            ("elsie", "Could I take some home for my dad? He loves your crumble."),
            ("greta", "Of course, love, I'll put some in a tub for him."),
        ],
        "b": [
            ("greta", "Did your dad like the crumble, Elsie?"),
            ("elsie", "He finished it in one evening. He wants the recipe now."),
            ("rafi", "I tried making it myself last week. It was a disaster."),
            ("me", "What went wrong, Rafi?"),
            ("rafi", "I used salt instead of sugar in the topping. Don't ask."),
            ("greta", "Oh dear. I'll write the recipe down properly for both of you."),
            ("elsie", "Thanks Greta."),
        ],
    },
    {
        "id": "studio",
        "people": {
            # Two similar young female US voices.
            "joss": {"name": "Joss", "role": "photographer", "voice": ("k", 4)},  # af_jessica
            "wren": {"name": "Wren", "role": "photographer", "voice": ("k", 8)},  # af_river
        },
        "a": [
            ("joss", "Hey, I'm Joss, I'm the one who emailed about renting the studio on Saturdays."),
            ("me", "Hi Joss, come through. The light is best in the mornings."),
            ("wren", "And I'm Wren, I work with Joss. We're doing portraits for a small magazine."),
            ("me", "Nice to meet you, Wren. How many people will be here on the day?"),
            ("wren", "Just the two of us and one model, maybe a hair stylist as well."),
            ("joss", "Is there somewhere to plug in the big lights? They need a lot of power."),
            ("me", "There are four sockets on the back wall, and a spare extension in the cupboard."),
            ("joss", "Perfect. Wren, did you bring the deposit?"),
            ("wren", "Yes, here it is, in cash. Can we get a receipt?"),
            ("me", "Of course, I'll write one now."),
        ],
        "b": [
            ("wren", "Morning! We're a bit early, hope that's okay."),
            ("me", "No problem, the heating is already on."),
            ("joss", "The magazine loved last week's photos, they want another six."),
            ("me", "That's great news. Same time every Saturday then?"),
            ("joss", "If that's alright with you, until the end of the month."),
            ("wren", "We'll leave the backdrop rolled up behind the door, if that's okay."),
            ("me", "Sure, just keep it away from the radiator."),
        ],
    },
    {
        "id": "bus",
        "people": {
            # Never named: should show as "Bus driver".
            "driver": {"name": None, "role": "bus driver|driver", "voice": ("k", 27)},  # bm_lewis
            "gwen": {"name": "Gwen", "role": "passenger", "voice": ("k", 22)},  # bf_isabella
        },
        "a": [
            ("driver", "Morning. Tap your card on the reader, please."),
            ("me", "Does this one go to the station?"),
            ("driver", "It does, the station is the fourth stop. Mind the doors behind you."),
            ("gwen", "Hello, I'm Gwen. Are you new on this route? I take it every day."),
            ("me", "Nice to meet you, Gwen. I've just moved here, so yes, all new."),
            ("gwen", "He always calls out the station, so you won't miss it."),
            ("driver", "Next stop, Market Square. Market Square next."),
            ("me", "Thanks. How long until the station from here?"),
            ("driver", "About ten minutes if the lights are kind."),
        ],
        "b": [
            ("driver", "Hello again. Single or return today?"),
            ("me", "Just a single to the station, please."),
            ("gwen", "Morning! Did you find your way around the new office?"),
            ("me", "Mostly, I only got lost once on the first day."),
            ("driver", "Mind the doors, please. Next stop, the library."),
            ("gwen", "That's me getting off. See you tomorrow."),
        ],
    },
    {
        "id": "shop",
        "people": {
            "assistant": {"name": None, "role": "shop assistant|cashier|shopkeeper", "voice": ("p", 550)},
        },
        "a": [
            ("assistant", "Hi there, did you find everything you were looking for?"),
            ("me", "Yes thanks, just these batteries and the light bulbs."),
            ("assistant", "That's eight pounds forty. Card or cash?"),
            ("me", "Card, please."),
            ("assistant", "Lovely. Do you need a bag for those?"),
            ("me", "No, I'll just put them in my pocket."),
            ("assistant", "Would you like your receipt?"),
            ("me", "No thanks, have a good day."),
        ],
        "b": [
            ("assistant", "Hello again. Is that everything for today?"),
            ("me", "Yes, just the milk and the bread."),
            ("assistant", "Would you like a bag for those? Card or cash?"),
            ("me", "Card, and no bag, thanks."),
            ("assistant", "There you go. Next customer, please."),
        ],
    },
    {
        "id": "surgery",
        "people": {
            "doctor": {"name": None, "role": "doctor|gp", "voice": ("k", 1)},  # af_alloy
        },
        "a": [
            ("doctor", "Come in and have a seat. So, what seems to be the problem?"),
            ("me", "I've had a sore shoulder for about three weeks now, mostly at night."),
            ("doctor", "Can you lift your arm above your head for me? Slowly."),
            ("me", "Up to about here, then it starts to hurt."),
            ("doctor", "Any allergies to medication that I should know about?"),
            ("me", "No, none that I know of."),
            ("doctor", "I'll prescribe some anti-inflammatories and refer you to physio."),
        ],
        "b": [
            ("doctor", "Good to see you again. How has the shoulder been since the physio?"),
            ("me", "Much better, I can sleep through the night now."),
            ("doctor", "Take a deep breath for me while I listen to your chest."),
            ("me", "Is everything alright?"),
            ("doctor", "Everything sounds fine. Keep up the exercises."),
        ],
    },
]
