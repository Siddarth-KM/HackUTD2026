You are a senior swe loan officer. You are tasked with building a 
new software that helps banks detect loan fraud. You are given a folder with 12 deals
some of which may be fraudelent, and some which are good. The patterns of fraud can show up
across multiple deals. Following is the data pipelien you are to use: 
Read the folder: 
    Pulling out the key facts → Gemini
        Use gemini LLM to get all the stuff from the file
        Flag missing/inconsistent items
Walking the deal through the steps given in the problem.
    Pulling out what was seen, what was decided, and why → Gemini
    Stages: Intake → Credit → Committee → Product → Committed → Closed
        Extract the “required to exit” and “checks” from the rules api and feed them into the Gemini LLM. Ignore “checks” if there is a “human gate”
        (3): If any stage has “human_gate” have a human verification process

            The required information to display is: which deal, what the deal is waiting on, and what steps need to be taken to unlock the deal.
            Add like a buffer period of 2 hours for a file to be marked as a warning; if its unresolved after, then escalate.
If a file seems to showcase a hidden pattern or seems to be supspopus it, flag it and hold it for review.
Here are the following patterns to look for:
    Benford's paradox
    Numbers not  up across deals
    More ways to test for fraud that you can find online
The rest of the info is in the file marked "DealPilot - Move the Deal. Stop the Fraud."
I also included a file that shows how the data will be given.


Make a comprehensive plan to build a backend for this project, using gemini API wherever necessary and as marked above. Make a simple, non finalized frontend, that interacts with the backend so we can test it. Create your own test data as well so we can test it on unseen date. See if you can find a way to use ML too. 

