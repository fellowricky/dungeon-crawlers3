# Dungeon Crawlers - Gold Rate Simulation & Balance Report

This report compares standard quest runs (**Baseline**) against runs where **Monster Gold Drops are removed entirely** (No Monster Gold), assuming standard **5-floor quest dungeons**, a party with a Thief (+25% chest gold), and standard approach skill challenges. Each level was simulated **200 times** to calculate statistical averages.

## Baseline vs No Monster Gold Comparison Table

| Level | Baseline Total | No Monster Gold Total | Direct Gold (No Mon) | Gear Resale (No Mon) | Chest Gold | Quest Reward Gold | Chest Gear Value |
| :---: | :------------: | :------------------: | :------------------: | :-----------------: | :--------: | :---------------: | :--------------: |
| **1** | 5592g | **4676g** | 2382g | 2295g | 1413g | 376g | 1084g |
| **2** | 8946g | **6987g** | 3538g | 3448g | 2049g | 498g | 1592g |
| **3** | 14603g | **10441g** | 4665g | 5776g | 2666g | 620g | 2816g |
| **4** | 21096g | **13620g** | 5828g | 7792g | 3291g | 752g | 3671g |
| **5** | 27797g | **17001g** | 6968g | 10033g | 3912g | 879g | 4521g |
| **6** | 41601g | **20857g** | 8116g | 12741g | 4541g | 1002g | 5525g |
| **7** | 54026g | **26569g** | 9256g | 17313g | 5171g | 1125g | 7574g |
| **8** | 72367g | **31459g** | 10380g | 21079g | 5781g | 1257g | 8770g |
| **9** | 96423g | **37215g** | 11500g | 25716g | 6409g | 1369g | 10638g |
| **10** | 137064g | **43106g** | 12649g | 30457g | 7050g | 1500g | 12320g |
| **11** | 183529g | **49234g** | 13771g | 35463g | 7661g | 1635g | 13722g |
| **12** | 229741g | **56802g** | 14888g | 41914g | 8291g | 1743g | 16141g |
| **13** | 315379g | **65772g** | 16046g | 49725g | 8919g | 1878g | 18075g |
| **14** | 411363g | **74220g** | 17164g | 57056g | 9541g | 1997g | 20108g |
| **15** | 529880g | **82006g** | 18344g | 63662g | 10168g | 2137g | 22187g |
| **16** | 640961g | **91546g** | 19477g | 72069g | 10799g | 2251g | 24781g |
| **17** | 674995g | **101554g** | 20611g | 80944g | 11415g | 2382g | 27154g |
| **18** | 765674g | **112999g** | 21761g | 91238g | 12043g | 2503g | 30071g |
| **19** | 807492g | **123273g** | 22857g | 100416g | 12664g | 2608g | 32593g |
| **20** | 937257g | **135309g** | 24049g | 111259g | 13294g | 2758g | 34643g |

## Income & Balance Analysis

- **Impact of Removing Monster Gold**: At level 1, removing monster gold drops reduces total income by **~16%** (from ~5.6k to ~4.7k). At level 10, it reduces total income by **~69%** (from ~137k to ~42k). At level 20, it reduces total income by **~85%** (from ~938k to ~136k).
- **Scale Control**: Removing monster gold drops completely flattens the runaway exponential growth curve. The remaining income scales much more smoothly, driven by Chests and Quest Completion rewards.
- **Gear Value Balance**: Reselling gear continues to be the dominant source of income at higher levels when monster drops are zero.

