// お題データ。言語ごとに配列で持つ（日本語は後で追加）
const PASSAGES = {
  en: [
    "The QWERTY keyboard layout was designed in the eighteen seventies for early typewriters, long before computers existed. A popular story claims that the letters were arranged to slow typists down, but a more likely reason is mechanical. Early typewriters jammed when neighboring type bars were struck in quick succession, so common letter pairs were spread apart to keep the machine running smoothly. Many alternative layouts have since been proposed, and some may allow faster typing. Even so, QWERTY has survived for more than a century, mostly because millions of people already know it and switching would mean learning to type all over again.",
    "When a honeybee finds a good patch of flowers, it returns to the hive and performs a short routine known as the waggle dance. The bee runs in a straight line while shaking its body, then circles back and repeats the movement many times. The angle of the straight run tells other bees which direction to fly, measured against the position of the sun. The length of the run shows how far away the flowers are. Other workers follow the dancer closely in the dark hive, sensing the vibrations with their antennae, and then leave to find the same food source on their own.",
    "Tardigrades, often called water bears, are tiny animals that are usually less than a millimeter long. They live almost everywhere, from mountain tops to the deep sea, and many of them can be found in the damp moss of an ordinary garden. When their surroundings dry out, they pull in their legs, lose most of the water in their bodies, and enter a state in which their life processes nearly stop. In this form they can survive extreme cold, strong radiation, and even a short trip to outer space. When water returns, they slowly wake up and carry on as if nothing had happened.",
    "Have you ever learned a new word and then suddenly noticed it everywhere? This experience is known as the frequency illusion. The word was probably around you all along, but your brain had no reason to pay attention to it. Once something becomes meaningful, attention starts to pick it out from the background, and each new sighting feels like a surprising coincidence. A second habit makes the effect stronger: we tend to notice examples that confirm what we already believe and ignore the times when nothing happens. Together, these two habits can make a rare event seem strangely common."
  ],
  ja: []
};

// 試し打ち用の短いお題（約15語・90文字前後）。URL に ?short を付けると使う
const PASSAGES_SHORT = {
  en: [
    "The QWERTY layout was made for typewriters, and it survives because so many people know it.",
    "A honeybee dances to tell other bees which way to fly and how far away the flowers are.",
    "Tardigrades can dry out, survive extreme cold, and wake up again when water returns.",
    "Once you learn a new word, you may suddenly start to notice it everywhere you look."
  ],
  ja: []
};
