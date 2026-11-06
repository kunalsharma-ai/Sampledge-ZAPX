/**
 * Every "i" help card in the SampCode CRM, in one place so anyone can edit the wording without
 * touching a page. Each entry answers three questions in plain language:
 *
 *   what  - what the feature is for (one or two sentences)
 *   how   - how to use it (one step per string; one string is shown as a sentence)
 *   where - where in the product and when in a project to use it
 *   tip   - optional extra advice
 *
 * Keys: `page.*` page headers, `tab.*` survey tabs, `section.*` panels and headings, `qtype.*`
 * question types (same keys as the survey schema), `sa.*` super admin. Use a key with
 * `<InfoTip k="section.quotas" />` (components/neon/InfoTip.tsx). TypeScript rejects unknown keys.
 */
export interface HelpEntry {
  title: string;
  what: string;
  how: string[];
  where: string;
  tip?: string;
}

const entries = {
  // ---------------------------------------------------------------- pages
  'page.dashboard': {
    title: 'Dashboard',
    what: 'Your home screen: live numbers for all your surveys, the latest activity and shortcuts to the work you do most.',
    how: [
      'Read the cards at the top for completes, response rate and quality across all surveys.',
      'Click a recent survey to open it, or use the shortcuts to create, program, test and launch.',
      'Use the search at the top to jump to any project, survey or page.',
    ],
    where: 'Start every working session here to see what changed and what needs attention.',
  },
  'page.projects': {
    title: 'Projects',
    what: 'A project groups the surveys of one study or client, together with its sample vendors, redirects and who may see it.',
    how: ['Click "Create project" and give it a name.', 'Open the project to add surveys and vendors.'],
    where: 'Create one project per study or client job before you build any survey.',
    tip: 'Members with assigned project access only see the projects they were added to.',
  },
  'page.project': {
    title: 'Project',
    what: 'Everything that belongs to one study: its surveys, the sample vendors that send respondents, redirect defaults and project access.',
    how: [
      'Create a survey from scratch, a template or an import.',
      'Add the sample vendors you buy respondents from and their redirect links.',
      'Choose which members may open this project.',
    ],
    where: 'Use it when you start a study and whenever you add a new vendor or teammate.',
  },
  'page.survey': {
    title: 'Survey workspace',
    what: 'The place where one survey is built, tested, launched and analysed. Each tab below is one step of the survey’s life.',
    how: [
      'Build the questionnaire (Build, Programmer or AI & import).',
      'Style it (Design, Languages) and check it (Preview, QA lab).',
      'Save the draft, then Publish to make it live for respondents.',
      'Send it out (Distribution, Interviewers), watch fieldwork (Quality, Quotas & data) and report (Analysis).',
    ],
    where: 'Work left to right through the tabs. You always edit a draft; respondents only ever see the published version.',
    tip: 'Every published version is kept, so you can compare or roll back from Programmer → Versions.',
  },
  'page.library': {
    title: 'Question bank',
    what: 'A shared library of questions and page blocks your team reuses across surveys, such as standard demographics or screeners.',
    how: [
      'In a survey’s Build tab, use "Save to question bank" on a question or page.',
      'Find saved items here, search and tag them.',
      'Insert them into another survey with "+ from bank" in the outline.',
    ],
    where: 'Use it to keep wording consistent between studies and to build new surveys faster.',
  },
  'page.calls': {
    title: 'Calls',
    what: 'The phone interviewer’s desk: it hands you the next person to call, shows the script and records the call outcome.',
    how: [
      'Pick a phone survey you are assigned to.',
      'Click "Next case", call the number shown and run the interview on screen.',
      'Save the call outcome (complete, callback, no answer, refusal).',
    ],
    where: 'Used by interviewers during CATI fieldwork. Callbacks come first and unanswered numbers are retried later automatically.',
  },
  'page.automation': {
    title: 'Automation',
    what: 'Rules that do routine work for you: when something happens (a quota fills, quality drops, a schedule fires) SampCode acts or asks you first.',
    how: [
      'Click "New rule" or start from a recipe.',
      'Choose the trigger, the conditions and the action.',
      'Decide if the action runs on its own or waits for approval.',
    ],
    where: 'Set rules up before fieldwork starts; check "Waiting for approval" and "Recent runs" during fieldwork.',
  },
  'page.appearance': {
    title: 'Themes & appearance',
    what: 'How the SampCode workspace looks to you: theme, light or dark mode, density, motion and accessibility options.',
    how: ['Pick a theme and mode; changes apply instantly.', 'Use Accessibility for larger text, high contrast or less motion.'],
    where: 'Change it any time. Administrators can also set the organization’s default look here.',
    tip: 'This styles the CRM itself. To style what respondents see, use a survey’s Design tab.',
  },
  'page.account': {
    title: 'My account',
    what: 'Your own profile and sign-in security.',
    how: ['Change your password here.', 'Use "Sign out everywhere" if you lost a device or think someone else signed in.'],
    where: 'Visit it when you join, and whenever you want to update your password.',
  },
  'page.settings': {
    title: 'Organization settings',
    what: 'Administration for your whole organization: team members and roles, AI, redirect defaults, single sign-on, API keys, webhooks, plan and data rules.',
    how: ['Scroll to the section you need; each one saves on its own.', 'Add teammates under Team and give each the right role.'],
    where: 'Used by administrators when setting SampCode up and whenever the team or integrations change.',
  },
  'page.apiKeys': {
    title: 'API keys',
    what: 'Keys that let scripts and other systems use SampCode on your behalf.',
    how: ['Create a key, give it a clear name and copy it straight away (it is shown only once).', 'Revoke keys that are no longer used.'],
    where: 'Use it when a developer connects SampCode to another tool.',
  },
  'page.audit': {
    title: 'Audit log',
    what: 'A permanent record of who did what and when: sign-ins, survey publishes, team changes, data exports and settings changes.',
    how: ['Filter by person, action or date.', 'Open an entry to see the details of the change.'],
    where: 'Use it for security reviews, client audits or to find out who changed something.',
  },
  'page.integrations': {
    title: 'Integrations',
    what: 'Connections to outside services that power features: Claude (AI), IPinfo (fraud checks), Deepgram (transcription), Twilio (calls and SMS), Stripe (billing) and S3 (file storage).',
    how: [
      'Open a service, paste its key and click "Test connection".',
      'Save; the feature that needs it switches on for everyone in the organization.',
    ],
    where: 'Set these up once when you start, or when a feature says it is "not connected yet".',
    tip: 'Keys are stored encrypted and are never shown again after saving.',
  },

  // ---------------------------------------------------------------- dashboard sections
  'section.dashJourney': {
    title: 'Survey journey',
    what: 'The steps every survey goes through, from draft to reporting, and how many of your surveys are at each step.',
    how: ['Click a step to see the surveys in it.'],
    where: 'Use it to spot surveys that are stuck, for example built but never tested.',
  },
  'section.dashTrend': {
    title: 'Survey performance',
    what: 'Completes and responses over the last 30 days, from live data.',
    how: ['Hover the chart to read the numbers for a day.'],
    where: 'Check it daily during fieldwork to see if responses are coming in as planned.',
  },
  'section.dashFunnel': {
    title: 'Respondent journey',
    what: 'How many people started, finished, were screened out or dropped out.',
    how: ['Compare the bars: a big drop between "started" and "complete" means the survey loses people.'],
    where: 'Use it to find surveys that are too long or have a confusing question.',
  },
  'section.dashStatus': {
    title: 'Response overview',
    what: 'All responses split by status: complete, terminated, over quota, quality fail and in progress.',
    how: ['Read the share of each status in the chart.'],
    where: 'Use it to see quickly whether fieldwork is healthy.',
  },
  'section.dashDevice': {
    title: 'Device distribution',
    what: 'Which devices respondents use: phone, tablet or desktop.',
    how: ['Compare the shares to check the survey works well on the devices people really use.'],
    where: 'Check it before launch decisions about design and question types (for example big grids on phones).',
  },
  'section.dashReach': {
    title: 'Global reach',
    what: 'The countries your respondents answer from.',
    how: ['Read the list or map to confirm people come from the markets you target.'],
    where: 'Use it during fieldwork as a quick fraud and targeting check.',
  },
  'section.dashCapabilities': {
    title: 'Create, program, test & launch',
    what: 'Shortcuts to the main jobs in SampCode.',
    how: ['Click a card to go straight to that step.'],
    where: 'Handy when you know what you want to do and want to skip the menus.',
  },
  'section.dashRecent': {
    title: 'Recent surveys',
    what: 'The surveys you or your team changed most recently.',
    how: ['Click one to open it.'],
    where: 'The fastest way back to the work you were doing.',
  },
  'section.dashCopilot': {
    title: 'AI copilot',
    what: 'Ask SampCode’s AI to draft a survey or a change in plain language.',
    how: [
      'Type what you need, for example "a 10 question brand awareness survey", and send it.',
      'Review the proposal before applying it.',
    ],
    where: 'Use it to get a first draft fast. Needs Claude connected in Settings › Integrations.',
  },
  'section.dashLook': {
    title: 'Choose your look',
    what: 'Quick theme switcher for the workspace.',
    how: ['Pick a theme; it applies immediately.'],
    where: 'Any time. More options are under Themes & appearance.',
  },
  'section.projectList': {
    title: 'Project list',
    what: 'All projects you can open, with their surveys and status.',
    how: ['Click a project to open it, or create a new one.'],
    where: 'Your starting point for any study.',
  },

  // ---------------------------------------------------------------- project page
  'section.projectSurveys': {
    title: 'Surveys',
    what: 'The surveys in this project.',
    how: [
      'Click "Create survey" to start one from scratch, a template, the question bank or an import.',
      'Click a survey to open its workspace.',
    ],
    where: 'Add every questionnaire of the study here, for example a main survey and a recontact survey.',
  },
  'section.vendors': {
    title: 'Sample vendors',
    what: 'The panels or suppliers that send respondents to your surveys, with the links respondents are sent back to when they finish, screen out or are over quota.',
    how: [
      'Click "+ Custom vendor" or pick a known vendor.',
      'Enter its complete, terminate and over-quota redirect links and the ID parameter it uses.',
      'Save; each survey then gets a vendor link in its Distribution tab.',
    ],
    where: 'Set vendors up before launch, once per project.',
    tip: 'Use the test link first: test responses never redirect to the vendor.',
  },
  'section.redirectDefaults': {
    title: 'Redirect defaults',
    what: 'Fallback redirect links used by direct vendors when a status or link is left empty.',
    how: ['Fill in the links for complete, terminate, over quota and quality fail.', 'Save.'],
    where: 'Set them once per project (or once for the organization in Settings) so no respondent hits a blank page.',
  },
  'section.projectAccess': {
    title: 'Project access',
    what: 'Who may open this project. Administrators and members with access to all projects always see it.',
    how: ['Tick the members who should see this project.'],
    where: 'Use it to keep client work private to the people working on it.',
  },

  // ---------------------------------------------------------------- survey tabs
  'tab.build': {
    title: 'Build',
    what: 'The visual questionnaire builder: pages, questions, answer options, logic, quotas and terminations, without writing code.',
    how: [
      'Pick a question type under "New question type", then "+ question" or "+ Add page".',
      'Click any item in the outline on the left to edit it on the right.',
      'Drag pages and questions to reorder them.',
      'Click "Survey settings" at the top of the outline for loops, variables, quotas and more.',
    ],
    where: 'Your main workspace while writing the questionnaire. The logic check on the right shows problems as you go.',
  },
  'tab.json': {
    title: 'JSON',
    what: 'The whole survey as one JSON document, exactly what the builder edits.',
    how: ['Edit the text and click "Apply JSON".', 'Copy it to share or back up a survey.'],
    where: 'For programmers who prefer text, or for bulk edits such as renaming many options at once.',
  },
  'tab.code': {
    title: 'Programmer',
    what: 'Tools for survey programmers: an expression debugger, the dependency explorer, versions and diffs, and Decipher-style XML migration.',
    how: [
      'Enter test answers and an expression to see exactly how logic evaluates.',
      'Check the dependency explorer before renaming or deleting a question.',
      'Compare the draft with any published version.',
    ],
    where: 'Use it while programming complex logic and before every publish.',
  },
  'tab.assist': {
    title: 'AI & import',
    what: 'Create or change the survey with AI in plain language, or import an existing questionnaire (Excel, CSV, Word, PDF or text).',
    how: [
      'Describe what you want, or upload a questionnaire file.',
      'SampCode creates a proposal; review every change.',
      'Apply the proposal to the draft, or reject it.',
    ],
    where: 'Use it at the start to turn a client questionnaire into a survey in minutes, or later for big edits.',
    tip: 'The Excel template is imported exactly and works without AI.',
  },
  'tab.design': {
    title: 'Design',
    what: 'How respondents see the survey: theme, colours, logo, fonts and which devices may take it.',
    how: ['Choose a theme and adjust colours and logo.', 'Allow or block phones, tablets and desktops.', 'Check the result in Preview.'],
    where: 'Use it once the questions are stable and before launch, to match the client’s brand.',
  },
  'tab.languages': {
    title: 'Languages',
    what: 'Translations of the survey, so each respondent sees it in their own language.',
    how: [
      'Click "Add language" and pick the language.',
      'Translate each text, or let the AI draft translations for review.',
      'Mark translations as reviewed; untranslated texts block publishing.',
    ],
    where: 'Use it for multi-country studies, after the source questionnaire is final.',
  },
  'tab.preview': {
    title: 'Preview',
    what: 'Take the draft survey exactly as a respondent would, on a phone, tablet or desktop frame.',
    how: ['Answer the questions; logic, piping and validation work as live.', 'Switch the device and language to check each one.'],
    where: 'Use it often while building. Nothing you answer here is saved.',
  },
  'tab.qa': {
    title: 'QA lab',
    what: 'Automatic testing: synthetic respondents run through every path of the survey and report errors, dead ends and questions never reached.',
    how: [
      'Choose how many test respondents and click "Run QA".',
      'Fix the problems in the report.',
      'Save test cases and run them after every change.',
    ],
    where: 'Run it before every publish. It saves no responses and never touches quotas.',
  },
  'tab.distribute': {
    title: 'Distribution',
    what: 'Get the survey to respondents: vendor links, a test link, email and SMS invitations, SampAudience audiences and the field status.',
    how: [
      'Publish the survey first.',
      'Copy the link for each vendor, or send invitations to your own contacts.',
      'Use the test link to try the live survey without counting toward quotas.',
    ],
    where: 'Use it on launch day and whenever you open or close fieldwork.',
  },
  'tab.capi': {
    title: 'Interviewers',
    what: 'Face-to-face (CAPI) and phone (CATI) interviewing: assign interviewers, upload call lists and watch their work.',
    how: [
      'Assign interviewers to the survey.',
      'For phone studies, upload the list of people to call.',
      'Follow progress in the supervisor dashboard.',
    ],
    where: 'Use it for studies with interviewers in the field or on the phone, rather than online self-completion.',
  },
  'tab.quality': {
    title: 'Quality & fieldwork',
    what: 'Live fieldwork numbers and automatic quality checks (speeders, straight-liners, duplicates, bots, VPNs) with a review queue.',
    how: [
      'Set the quality rules and thresholds, then publish.',
      'Review the completes that score low: approve or reject them.',
      'Tick "also block" to stop that device or network in every survey.',
    ],
    where: 'Check it every day during fieldwork. People decide; nothing is rejected silently.',
  },
  'tab.results': {
    title: 'Quotas & data',
    what: 'How full each quota is, the list of responses, and data exports (Excel and CSV).',
    how: ['Watch quota cells fill up.', 'Open a response to see its answers.', 'Start an export and download it when ready.'],
    where: 'Use it during and after fieldwork to monitor targets and to deliver data.',
  },
  'tab.analysis': {
    title: 'Analysis',
    what: 'Frequencies, crosstabs, charts, weighting and an AI research assistant, all on the live data.',
    how: [
      'Choose who to include and the questions to show.',
      'Add a banner for crosstabs, and weighting if needed.',
      'Save the report to come back to it.',
    ],
    where: 'Use it during fieldwork for top-lines and at the end for the full report.',
  },

  // ---------------------------------------------------------------- build tab
  'section.surveySettings': {
    title: 'Survey settings',
    what: 'Settings for the whole survey: title, welcome and thank-you texts, going back, progress bar and similar options.',
    how: ['Fill in the texts and tick the options you want.'],
    where: 'Set them at the start; check them again before launch.',
  },
  'section.terminations': {
    title: 'Terminations',
    what: 'Rules that end the interview early, for example when someone does not qualify (a screen-out).',
    how: ['Add a rule with a condition, e.g. answer(Q1) == 2.', 'Choose terminate or quality fail.'],
    where: 'Use it for screeners at the start of the survey. Rules are checked after every page and the first match wins.',
  },
  'section.quotas': {
    title: 'Quotas',
    what: 'Targets for how many completes you need per group (for example 100 men and 100 women). When a group is full, new people in it are sent out as over quota.',
    how: [
      'Add a quota, pick the question or condition and set the target per cell.',
      'Use the quota table builder for combined cells like age × gender.',
    ],
    where: 'Set quotas before launch so you do not pay for completes you do not need.',
  },
  'section.page': {
    title: 'Page',
    what: 'One screen of the survey. All questions on a page are shown together.',
    how: ['Add questions to the page.', 'Set "Show only if" to skip the whole page for some respondents.'],
    where: 'Group questions that belong together; put screeners on their own pages.',
  },
  'section.question': {
    title: 'Question',
    what: 'The selected question: its text, answer options, logic and validation.',
    how: [
      'Edit the variable name and question text (use {{VAR}} to show an earlier answer).',
      'Add "Show only if" to ask it only to some people.',
      'Set required, validation and randomisation.',
    ],
    where: 'Every question in the outline opens here.',
  },
  'section.newQuestionType': {
    title: 'New question type',
    what: 'The type of question that "+ question" and "+ Add page" create.',
    how: ['Pick a type, then click "+ question" under a page. Use the "i" next to the list to learn about the chosen type.'],
    where: 'Change it before adding each question.',
  },
  'section.loops': {
    title: 'Loops',
    what: 'Ask the same pages once for each item, for example once for every brand the person uses.',
    how: ['Add a loop, choose the pages and the list of items.', 'Use {{LOOP}} in the text to show the current item.'],
    where: 'Use it for brand evaluations, product tests or any repeated block.',
  },
  'section.blocks': {
    title: 'Randomized blocks',
    what: 'Show a run of pages in a random order to each respondent, or only some of them (for example 2 of 4 concepts).',
    how: ['Add a block, choose its pages and how many to show.'],
    where: 'Use it in concept tests to avoid order bias.',
  },
  'section.variables': {
    title: 'Calculated variables',
    what: 'Values worked out from answers, such as a score or a segment, usable in logic, quotas, piping and exports.',
    how: ['Add a variable, give it a name and an expression.'],
    where: 'Use it for segmentations, scores or anything you would otherwise compute in Excel later.',
  },
  'section.recodes': {
    title: 'Recodes',
    what: 'New analysis variables that group answers, such as age bands or top-2 box. Original answers are never changed.',
    how: ['Pick the source variable.', 'Write one group per line: code | label | values (for example 1 | 18-34 | 18..34).'],
    where: 'Use it before analysis so banners and tables show grouped answers.',
  },
  'section.cleaning': {
    title: 'Cleaning rules',
    what: 'Fix or fill answers when data is analysed or exported. Stored answers are never changed.',
    how: ['Add a rule: set, clear or impute.', 'Give it a condition (empty applies to every record).'],
    where: 'Use it after fieldwork to clean data reproducibly instead of by hand.',
  },
  'section.urlVariables': {
    title: 'URL variables',
    what: 'Values passed on the survey link, such as &seg=B2B from a panel or CRM. They are saved with the response like an answer.',
    how: ['Add the parameter name.', 'Use it in conditions, quotas and piping.'],
    where: 'Use it when a vendor or client already knows something about the respondent.',
  },
  'section.dynamicList': {
    title: 'Dynamic options',
    what: 'Fill this question’s options from the answers to an earlier question, for example only the brands they know.',
    how: ['Choose the source question and whether to show selected or unselected options.'],
    where: 'Use it for follow-ups such as "Which of these brands do you use most?".',
  },
  'section.media': {
    title: 'Media',
    what: 'Images, video or audio shown with the question.',
    how: ['Upload a file or choose one from the media library.'],
    where: 'Use it for ad tests, packaging tests and concept boards.',
  },
  'section.logicCheck': {
    title: 'Logic check',
    what: 'Live checks of the draft: missing options, broken conditions, unknown variables and other errors that would stop publishing.',
    how: ['Click a problem to jump to it, fix it, and the list updates.'],
    where: 'Keep an eye on it while building. Publish stays disabled while errors remain.',
  },

  // ---------------------------------------------------------------- AI & import
  'section.aiArchitect': {
    title: 'AI Survey Architect',
    what: 'Describe a survey or a change in plain language and the AI drafts it for you as a proposal.',
    how: ['Type your instruction, for example "add an NPS question at the end".', 'Review the proposal and apply it.'],
    where: 'Use it for first drafts and large edits. Needs Claude connected in Settings › Integrations.',
  },
  'section.import': {
    title: 'Import a questionnaire',
    what: 'Turn an existing questionnaire file into a survey.',
    how: ['Download the Excel template for exact imports, or upload Word, PDF or text.', 'Check the confidence score per row and apply.'],
    where: 'Use it when the client sends a questionnaire document.',
  },
  'section.proposals': {
    title: 'Proposals',
    what: 'Every change the AI or an import suggested, waiting for your decision.',
    how: ['Open a proposal to see each change.', 'Apply or reject it.'],
    where: 'Nothing changes the draft until you apply a proposal.',
  },

  // ---------------------------------------------------------------- programmer
  'section.testAnswers': {
    title: 'Test answers',
    what: 'A pretend respondent’s answers used by the debugger.',
    how: ['Edit any answer in the JSON; the results on the right update.'],
    where: 'Use it to reproduce a routing problem someone reported.',
  },
  'section.expression': {
    title: 'Expression',
    what: 'Evaluate any logic expression against the test answers and see each step.',
    how: ['Type an expression such as selected(Q2, 3) and read the trace.'],
    where: 'Use it to check conditions before you put them in the survey.',
  },
  'section.dependencies': {
    title: 'Dependency explorer',
    what: 'What each question reads, and everything that reads it.',
    how: ['Pick a question to see its links.'],
    where: 'Check it before renaming or deleting anything.',
  },
  'section.versions': {
    title: 'Versions & diff',
    what: 'Every published version, kept unchanged, with a comparison against the draft.',
    how: ['Pick a version to see the differences.', 'Load an old version back into the draft if needed.'],
    where: 'Use it before publishing to review exactly what changes for respondents.',
  },
  'section.xmlMigrate': {
    title: 'XML migration',
    what: 'Convert a Decipher-style XML survey into a SampCode survey.',
    how: ['Paste the XML or choose a file.', 'Read the list of items to rebuild by hand.', 'Check the result in Build and the QA lab.'],
    where: 'Use it when moving existing surveys from another platform.',
  },
  'section.testCases': {
    title: 'Test cases',
    what: 'Saved answers with the route and ending they must produce.',
    how: ['Save cases from Programmer → Debugger.', 'Click "Run test cases" after each change.'],
    where: 'Use it to make sure a change never breaks logic that already worked.',
  },

  // ---------------------------------------------------------------- design & languages
  'section.theme': {
    title: 'Theme',
    what: 'The look of the respondent survey: preset, colours, logo and fonts.',
    how: ['Choose a preset and adjust it.', 'Check it in Preview.'],
    where: 'Use it to match the client’s brand before launch.',
  },
  'section.devices': {
    title: 'Devices',
    what: 'Which devices may take the survey. Respondents on other devices are screened out before starting.',
    how: ['Tick the devices that are allowed.'],
    where: 'Use it when the survey only works on large screens, for example a big grid or a shelf test.',
  },
  'section.languages': {
    title: 'Languages',
    what: 'The source language and the translations of this survey.',
    how: ['Add a language, translate the texts and mark them reviewed.'],
    where: 'Use it for multi-country studies.',
  },
  'section.language': {
    title: 'Translation',
    what: 'The translation of every text into this language.',
    how: ['Fill each text, or let the AI draft them.', 'Mark reviewed when a native speaker has checked it.'],
    where: 'Untranslated or unreviewed languages block publishing.',
  },

  // ---------------------------------------------------------------- QA lab
  'section.qaLab': {
    title: 'QA Laboratory',
    what: 'Synthetic respondents test every option, boundary and skip in your survey.',
    how: ['Set the number of respondents and click "Run QA".', 'Read the report: anything never reached is listed.'],
    where: 'Before every publish. Nothing is saved as a response.',
  },
  'section.qaRuns': {
    title: 'Past runs',
    what: 'Earlier QA runs with their result and coverage.',
    how: ['Click a run to open its report.'],
    where: 'Use it to show the client the survey was tested.',
  },
  'section.qaReport': {
    title: 'QA report',
    what: 'The result of one QA run: pass or fail, coverage and every problem found.',
    how: ['Fix each problem and run QA again.'],
    where: 'Aim for a pass with high coverage before going live.',
  },

  // ---------------------------------------------------------------- distribution
  'section.vendorLinks': {
    title: 'Vendor links',
    what: 'The survey link to give each sample vendor. Each one records where respondents come from and redirects them back.',
    how: ['Copy a vendor’s link and send it to the vendor.'],
    where: 'Use it on launch day. Add vendors in the project page first.',
  },
  'section.testLink': {
    title: 'Test link',
    what: 'A link to the live survey for testing. Test responses are flagged, left out of quotas and exports, and never redirect.',
    how: ['Open it and take the survey.'],
    where: 'Use it right after publishing, and send it to the client for sign-off.',
  },
  'section.fieldStatus': {
    title: 'Field status',
    what: 'Whether the survey is live, paused or closed. Paused and closed surveys send new respondents to the quota-full redirect; people already in progress can finish.',
    how: ['Use Go live, Pause or Close.'],
    where: 'Close the survey when quotas are met, so no extra respondents come in.',
  },
  'section.invitations': {
    title: 'Email and SMS invitations',
    what: 'Send personal survey links to your own contact list, with reminders and one-click unsubscribe.',
    how: [
      'Upload the contact list (CSV).',
      'Write the message, pick when to send the wave, and set reminders for people who have not finished.',
    ],
    where: 'Use it for customer and employee surveys where you own the contacts.',
  },
  'section.sampleon': {
    title: 'SampAudience audiences',
    what: 'Order respondents from the SUPPLY360 panels: feasibility check, approval and automatic outcome reporting.',
    how: ['Describe the audience and check feasibility.', 'Send for approval, then launch.'],
    where: 'Use it when you need panel sample instead of your own contacts. Publish the survey first.',
  },

  // ---------------------------------------------------------------- interviewers
  'section.capiAssign': {
    title: 'Interviewers (CAPI and phone)',
    what: 'Which interviewers may run this survey face to face in the SampCode Interviewer app, or on the phone from Calls.',
    how: ['Tick the interviewers to assign.', 'They download the live version and can interview offline.'],
    where: 'Use it before face-to-face or phone fieldwork starts.',
  },
  'section.cati': {
    title: 'Phone interviews (CATI)',
    what: 'The list of people to call and the calling rules (callbacks, retries, maximum attempts).',
    how: ['Upload the people to call (CSV).', 'Set retries and attempts.', 'Interviewers then work the list from Calls.'],
    where: 'Use it for telephone studies. Numbers are stored encrypted.',
  },
  'section.dnc': {
    title: 'Do-not-call list',
    what: 'Numbers that must never be called again. Anyone who asks on a call is added automatically.',
    how: ['Add numbers by hand or upload a list.'],
    where: 'Keep it up to date to respect people’s wishes and the law.',
  },
  'section.supervisor': {
    title: 'Supervisor dashboard',
    what: 'Progress of face-to-face interviewers: interviews per person, locations, durations and quality flags.',
    how: ['Click Refresh to get the latest synced interviews.'],
    where: 'Check it daily during face-to-face fieldwork.',
  },

  // ---------------------------------------------------------------- quality
  'section.fieldwork': {
    title: 'Fieldwork',
    what: 'Live counts for this survey: starts, completes, terminates, drop-outs and the average length.',
    how: ['Read the cards; test links are excluded.'],
    where: 'Check it every day during fieldwork.',
  },
  'section.qualityReview': {
    title: 'Quality review',
    what: 'Completes that scored below the review threshold, waiting for a person to decide.',
    how: ['Open each complete and read why it was flagged.', 'Approve or reject; tick "also block" to stop that device or network.'],
    where: 'Work through it daily so vendors get fast feedback.',
  },
  'section.capiCapture': {
    title: 'Face-to-face capture',
    what: 'What the Interviewer app records during face-to-face interviews: location, audio and photos.',
    how: ['Choose what to record, then save and publish.'],
    where: 'Use it for CAPI studies that need proof of interview.',
  },
  'section.blocked': {
    title: 'Blocked devices and networks',
    what: 'Devices and networks you rejected for fraud. Completes from them are flagged in every survey of your organization.',
    how: ['Add them when rejecting a complete; remove one here if blocked by mistake.'],
    where: 'Use it to stop the same cheater coming back.',
  },
  'section.qualitySettings': {
    title: 'Quality settings',
    what: 'The automatic checks and thresholds: speeding, straight-lining, gibberish, duplicates, VPNs and bots.',
    how: ['Switch checks on, set the thresholds, then save and publish.'],
    where: 'Set them before launch; tune them after the first day of fieldwork.',
  },

  // ---------------------------------------------------------------- quotas & data
  'section.quotaProgress': {
    title: 'Quotas',
    what: 'How full each quota cell is right now.',
    how: ['Watch the bars; full cells send new people out as over quota.'],
    where: 'Check it during fieldwork and tell vendors which groups are still needed.',
  },
  'section.responses': {
    title: 'Responses',
    what: 'Every interview with its status, source and answers.',
    how: ['Filter by status, open a response to see answers.'],
    where: 'Use it to check individual interviews or answer vendor questions.',
  },
  'section.exports': {
    title: 'Exports',
    what: 'Download the data as Excel or CSV, with labels, recodes and cleaning applied.',
    how: ['Choose whether to include test responses, then start a background CSV or Excel export.', 'Download it when it is ready.'],
    where: 'Use it to deliver data to clients or for analysis in other tools.',
  },

  // ---------------------------------------------------------------- analysis
  'section.savedReports': {
    title: 'Saved reports',
    what: 'Analysis set-ups you saved, so you can open the same tables again with fresh data.',
    how: ['Click "Save report" after setting up tables.', 'Click a saved report to open it.'],
    where: 'Use it for daily top-lines during fieldwork.',
  },
  'section.whoToInclude': {
    title: 'Who to include',
    what: 'Which interviews are counted in the tables, by status, date, vendor or answers.',
    how: ['Tick the statuses and set filters.'],
    where: 'Normally completes only. Add others to study drop-outs.',
  },
  'section.weighting': {
    title: 'Weighting',
    what: 'Adjusts results so the sample matches known population shares, for example by gender and age.',
    how: ['Add a variable and enter the target share for each group.', 'Check the achieved weights.'],
    where: 'Use it when your sample is unbalanced compared with the real population.',
  },
  'section.choiceResults': {
    title: 'MaxDiff and conjoint',
    what: 'Scores from MaxDiff and conjoint questions: importance, preference shares and simulations.',
    how: ['Pick the choice question to see its results.'],
    where: 'Use it to report which features or messages matter most.',
  },
  'section.eyeResults': {
    title: 'Eye tracking results',
    what: 'Heatmaps and area-of-interest figures estimated from respondents’ webcams. Experimental: treat as approximate.',
    how: ['Pick the eye tracking question and an area of interest.'],
    where: 'Use it for ad and packaging tests.',
  },
  'section.assistant': {
    title: 'Research assistant',
    what: 'Ask a question about the results in plain language. SampCode computes the tables and the AI explains them, citing each table.',
    how: ['Type your question, for example "Which age group likes the concept most?".', 'Check each finding against the cited table.'],
    where: 'Use it to find stories in the data faster. Open answers are never sent to the AI.',
  },

  // ---------------------------------------------------------------- settings
  'section.team': {
    title: 'Team',
    what: 'Everyone in your organization and their role: admin, programmer, viewer or interviewer.',
    how: ['Click "Add member", enter their email and choose a role.', 'Set project access to all or assigned projects.'],
    where: 'Use it when someone joins or leaves, or needs different rights.',
  },
  'section.ai': {
    title: 'AI',
    what: 'Whether AI features are allowed in your organization, for which tasks, and how much was used this month.',
    how: ['Allow AI and tick the tasks it may help with.', 'Set a monthly budget (0 means no cap).'],
    where: 'Set it once; check usage at month end.',
  },
  'section.orgRedirects': {
    title: 'Organization redirect defaults',
    what: 'Redirect links used for any project that has none of its own.',
    how: ['Enter the links and save.'],
    where: 'Set them once when you start with SampCode.',
  },
  'section.sso': {
    title: 'Single sign-on',
    what: 'Let members sign in with your company account (SAML or OpenID Connect) instead of a password.',
    how: ['Choose the protocol and paste the details from your identity provider.', 'Save and test with "Sign in with SSO".'],
    where: 'Set it up once with your IT team.',
  },
  'section.scim': {
    title: 'SCIM provisioning',
    what: 'Let your identity provider add, update and remove SampCode members automatically.',
    how: ['Create a SCIM token and paste it and the URL into your identity provider.'],
    where: 'Use it in larger companies so access follows HR changes.',
  },
  'section.plan': {
    title: 'Plan',
    what: 'Your subscription and how much of it you use: members, interviewers, live surveys and completes this month.',
    how: ['Read the meters; ask your SampCode contact or use Billing to change plan.'],
    where: 'Check it before a big study so you do not run out of completes mid-fieldwork.',
  },
  'section.billing': {
    title: 'Billing',
    what: 'Pay for and change your plan online.',
    how: ['Choose a plan and complete checkout.'],
    where: 'Used by administrators when upgrading.',
  },
  'section.webhooks': {
    title: 'Webhooks',
    what: 'SampCode sends a signed message to your system when something happens, such as a complete or a quota filling.',
    how: ['Add the URL of your system and pick the events.', 'Check the signature with the secret shown once.'],
    where: 'Use it to connect SampCode to your CRM, data warehouse or alerts.',
  },
  'section.governance': {
    title: 'Data residency and retention',
    what: 'Where your data is stored and how long responses, captures and contacts are kept before they are deleted.',
    how: ['Enter the number of days to keep each kind of data and save.'],
    where: 'Set it to match your contracts and privacy rules (for example GDPR).',
  },
  'section.integrationSetup': {
    title: 'Set up per organization',
    what: 'Services your organization connects with its own keys.',
    how: ['Open a service, paste its key, test and save.'],
    where: 'Use it when you want features billed to your own accounts.',
  },
  'section.integrationServer': {
    title: 'Still set on the server',
    what: 'Services configured by your SampCode operator for the whole installation.',
    how: ['Nothing to do here; ask your operator to change them.'],
    where: 'For information only.',
  },
  'section.integration': {
    title: 'Integration',
    what: 'One outside service and its connection details.',
    how: ['Paste the key, click "Test connection", then save.'],
    where: 'Use it when a feature that needs this service says it is not connected.',
  },
  'section.password': {
    title: 'Change password',
    what: 'Set a new password. Your other devices are signed out; this one stays signed in.',
    how: ['Enter your current password and the new one twice.'],
    where: 'Change it regularly, or right away if you think it leaked.',
  },

  // ---------------------------------------------------------------- automation
  'section.autoApprovals': {
    title: 'Waiting for approval',
    what: 'Actions a rule wants to take that need a person’s OK first.',
    how: ['Approve or reject each one.'],
    where: 'Check it during fieldwork so rules are not held up.',
  },
  'section.autoRules': {
    title: 'Rules',
    what: 'Your automation rules and whether each is on.',
    how: ['Switch a rule on or off, or click Edit to change it.'],
    where: 'Review them before each new study.',
  },
  'section.autoRuns': {
    title: 'Recent runs',
    what: 'What the rules did recently and whether it worked.',
    how: ['Open a run to see details or errors.'],
    where: 'Use it to confirm a rule did what you expected.',
  },
  'section.autoEditor': {
    title: 'Rule editor',
    what: 'Set up when a rule runs and what it does.',
    how: ['Choose the trigger (event or schedule), add conditions, pick the action and save.'],
    where: 'Use it to create or change a rule.',
  },

  // ---------------------------------------------------------------- appearance
  'section.appTheme': {
    title: 'Theme',
    what: 'The overall style of the workspace.',
    how: ['Click a theme to apply it.'],
    where: 'Choose the one you find easiest to work with.',
  },
  'section.appMode': {
    title: 'Mode, density and motion',
    what: 'Light or dark mode, how compact the screens are and how much animation you see.',
    how: ['Pick the options; they apply at once.'],
    where: 'Use compact density on small laptops; switch motion off if animations distract you.',
  },
  'section.appColour': {
    title: 'Colour and light',
    what: 'Accent colours and glow strength.',
    how: ['Pick colours or move the sliders.'],
    where: 'Personal taste; it does not affect respondents.',
  },
  'section.appAccess': {
    title: 'Accessibility',
    what: 'Larger text, high contrast, focus outlines and reduced motion.',
    how: ['Switch on what helps you.'],
    where: 'Use it any time you find the screen hard to read.',
  },
  'section.appOrgDefault': {
    title: 'Organization default',
    what: 'The look new members get. Members can still change their own.',
    how: ['Set the look, then save it as the organization default.'],
    where: 'Used by administrators to give the team a consistent look.',
  },
  'section.appByArea': {
    title: 'Theme by area',
    what: 'A different theme for each area of work, for example build, fieldwork and analysis.',
    how: ['Pick a theme for each area.'],
    where: 'Helps you see at a glance which kind of work you are in.',
  },
  'section.appPresets': {
    title: 'Workspace presets',
    what: 'Saved combinations of appearance settings.',
    how: ['Save the current look as a preset; click a preset to apply it.'],
    where: 'Use it to switch quickly, for example between day and night set-ups.',
  },
  'section.appPreview': {
    title: 'Live preview',
    what: 'Sample buttons, fields and tables in the current look.',
    how: ['Change settings and watch the preview.'],
    where: 'Check it before saving an organization default.',
  },

  // ---------------------------------------------------------------- calls
  'section.phoneSurveys': {
    title: 'Phone surveys',
    what: 'The live phone surveys you are assigned to.',
    how: ['Click a survey, then "Next case" to get someone to call.'],
    where: 'Start each calling session here.',
  },
  'section.currentCall': {
    title: 'Current survey',
    what: 'The survey you are calling for, with the next case and its history.',
    how: ['Call the number, run the interview, then save the call outcome.'],
    where: 'Used during each call.',
  },

  // ---------------------------------------------------------------- library
  'section.libraryList': {
    title: 'Saved questions and blocks',
    what: 'Everything saved to the question bank.',
    how: ['Search or filter by tag.', 'Edit or delete items you no longer need.'],
    where: 'Keep it tidy so the team finds the right standard questions.',
  },

  // ---------------------------------------------------------------- question types
  'qtype.single': {
    title: 'Single choice',
    what: 'The respondent picks exactly one answer from a list.',
    how: ['Add the options with their codes.', 'Tick "randomize" to shuffle them; keep "Other" or "None" fixed.'],
    where: 'Use it for gender, yes/no, the brand used most and most screener questions.',
  },
  'qtype.multi': {
    title: 'Multiple choice',
    what: 'The respondent picks every answer that applies.',
    how: ['Add the options.', 'Mark "None of these" as exclusive so it cannot be combined.', 'Set a minimum or maximum if needed.'],
    where: 'Use it for awareness, brands used, channels seen.',
  },
  'qtype.open': {
    title: 'Open text',
    what: 'The respondent types an answer in their own words.',
    how: ['Choose short or long text and an optional length limit.'],
    where: 'Use it sparingly for "why" questions and suggestions; it is the slowest to answer and to analyse.',
  },
  'qtype.numeric': {
    title: 'Numeric',
    what: 'The respondent enters a number, in a box or on a slider.',
    how: ['Set minimum and maximum (needed for a slider) and decimals.'],
    where: 'Use it for age, household size, spend or counts.',
  },
  'qtype.grid': {
    title: 'Grid',
    what: 'Several statements rated on the same answer scale, one row each.',
    how: ['Add the rows (statements) and the columns (scale points).'],
    where: 'Use it for attribute ratings. Keep grids short: they are tiring on phones.',
  },
  'qtype.scale': {
    title: 'Rating scale / NPS',
    what: 'One rating on a scale, such as 1-5 satisfaction or 0-10 Net Promoter Score.',
    how: ['Choose the scale length and the end labels.'],
    where: 'Use it for satisfaction, likelihood to recommend and purchase intent.',
  },
  'qtype.ranking': {
    title: 'Ranking',
    what: 'The respondent puts items in order of preference.',
    how: ['Add the items; set how many must be ranked.'],
    where: 'Use it when you need a clear order, with 7 items or fewer.',
  },
  'qtype.sum': {
    title: 'Constant sum',
    what: 'The respondent shares a fixed total (for example 100 points or 100%) across items.',
    how: ['Add the items and set the total.'],
    where: 'Use it for share of wallet or relative importance.',
  },
  'qtype.cardsort': {
    title: 'Card sort',
    what: 'The respondent drags cards into groups (piles).',
    how: ['Add the cards and the groups.'],
    where: 'Use it for categorising features, messages or website menus.',
  },
  'qtype.hotspot': {
    title: 'Image hot-spot',
    what: 'The respondent clicks the parts of an image they like or notice.',
    how: ['Upload the image and draw the areas to report on.'],
    where: 'Use it for ads, packaging and web page tests.',
  },
  'qtype.photo': {
    title: 'Photo',
    what: 'The respondent takes or uploads a photo.',
    how: ['Add the question; set how many photos are allowed.'],
    where: 'Use it for receipts, shelf checks and diaries.',
  },
  'qtype.signature': {
    title: 'Signature',
    what: 'The respondent signs on the screen.',
    how: ['Add the question with the consent text.'],
    where: 'Use it for consent forms in face-to-face interviews.',
  },
  'qtype.barcode': {
    title: 'Barcode / QR code',
    what: 'The respondent scans a product barcode or QR code with the camera.',
    how: ['Add the question; the scanned code is stored as the answer.'],
    where: 'Use it for product checks in store or at home.',
  },
  'qtype.maxdiff': {
    title: 'MaxDiff (best-worst)',
    what: 'The respondent sees small sets of items and picks the best and the worst in each. It gives a reliable ranking of many items.',
    how: ['Add the items and set items per set and number of sets.', 'See the scores in Analysis.'],
    where: 'Use it to rank 8-30 features, claims or messages.',
  },
  'qtype.conjoint': {
    title: 'Conjoint (choice-based)',
    what: 'The respondent chooses between product profiles built from attributes and levels, which shows how much each attribute matters.',
    how: ['Add attributes and levels, then the number of tasks.', 'Use the simulator in Analysis.'],
    where: 'Use it for pricing and product design.',
  },
  'qtype.eyetrack': {
    title: 'Eye tracking (webcam, experimental)',
    what: 'Estimates where the respondent looks on an image using their webcam, with their permission.',
    how: ['Upload the stimulus and mark areas of interest.', 'Read the heatmap in Analysis.'],
    where: 'Use it for ad and packaging tests. Results are approximate.',
  },
  'qtype.info': {
    title: 'Information',
    what: 'Text, an image or a video shown with no answer to give.',
    how: ['Write the text or add media.'],
    where: 'Use it for introductions, instructions and section breaks.',
  },

  // ---------------------------------------------------------------- super admin
  'sa.overview': {
    title: 'Super admin',
    what: 'The control centre for the whole SampCode installation: every organization, its plan, members and activity.',
    how: ['Register organizations, set plans and features, and automate subscription handling from here.'],
    where: 'Only for SampCode operators.',
  },
  'sa.organizations': {
    title: 'Organizations',
    what: 'Every customer organization, with its plan and status.',
    how: ['Register a new organization, or open one to manage it.'],
    where: 'Use it when onboarding a new customer.',
  },
  'sa.organization': {
    title: 'Organization',
    what: 'One customer: its subscription, features, integrations, members and activity.',
    how: ['Change the plan or dates, switch single features on or off, and suspend if needed.'],
    where: 'Use it for upgrades, trials and support questions.',
  },
  'sa.members': {
    title: 'Members',
    what: 'Every account on this installation.',
    how: ['Search a person and open their organization.'],
    where: 'Use it for support requests.',
  },
  'sa.plans': {
    title: 'Plans & features',
    what: 'What each subscription includes on the web CRM and the mobile app, and its limits.',
    how: ['Create or edit a plan and tick its features.'],
    where: 'Use it when you change your price list.',
  },
  'sa.automation': {
    title: 'Subscription automation',
    what: 'Rules that warn before subscriptions end, suspend or downgrade, start trials and alert on usage.',
    how: ['Add a ready-made rule and adjust it.'],
    where: 'Set it once so renewals never depend on someone remembering.',
  },
  'sa.integrations': {
    title: 'Platform integrations',
    what: 'Integrations used by every organization, and which organizations may use their own.',
    how: ['Set keys on the setup page; allow own integrations per organization.'],
    where: 'Use it when setting up the installation.',
  },
  'sa.activity': {
    title: 'Activity',
    what: 'Sign-ins, survey changes, team and integration changes and every super admin action, from all organizations.',
    how: ['Filter by organization or action.'],
    where: 'Use it for security reviews and support.',
  },
  'sa.subscriptions': {
    title: 'Subscriptions',
    what: 'How many organizations are on each plan.',
    how: ['Click "Plans & features" to change what plans include.'],
    where: 'A quick health check of the business.',
  },
  'sa.ending': {
    title: 'Ending in the next 30 days',
    what: 'Subscriptions that end soon.',
    how: ['Open an organization to renew or extend it.'],
    where: 'Check it weekly to avoid unplanned suspensions.',
  },
  'sa.features': {
    title: 'Features',
    what: 'Switch single features on or off for this organization, on top of its plan.',
    how: ['Tick or untick a feature; it applies live, also in the mobile app.'],
    where: 'Use it for trials of one feature or to switch something off.',
  },
  'sa.orgOwnIntegrations': {
    title: 'Organizations’ own integrations',
    what: 'Which integrations each organization may connect with its own keys. Unticked ones are blocked in the web CRM and the mobile app.',
    how: ['Tick or untick per organization; it applies at once.'],
    where: 'Use it when a customer wants to bring their own AI, telephony or storage account.',
  },
  'sa.subscription': {
    title: 'Subscription',
    what: 'This organization’s plan, status, trial and end dates.',
    how: ['Change the plan or dates and save; suspend or reactivate if needed.'],
    where: 'Use it for renewals, upgrades and unpaid accounts.',
  },
  'sa.register': {
    title: 'Register an organization',
    what: 'Create a new customer organization with its first administrator and plan.',
    how: ['Enter the organization name, the admin’s email and the plan, then register.'],
    where: 'Use it when a new customer signs up.',
  },
  'sa.newPlan': {
    title: 'New plan',
    what: 'Create a subscription plan with its limits and features.',
    how: ['Give it a code and name, set limits, tick features and save.'],
    where: 'Use it when you add a new price tier.',
  },
  'sa.readyRules': {
    title: 'Ready-made rules',
    what: 'Common subscription rules you can add in one click.',
    how: ['Click a rule to add it switched on; change it afterwards if needed.'],
    where: 'The fastest way to start with subscription automation.',
  },
  'sa.newRule': {
    title: 'New rule',
    what: 'Build your own subscription rule: when it applies and what it does.',
    how: ['Pick the trigger, the plans it applies to and the action, then save.'],
    where: 'Use it when the ready-made rules do not fit.',
  },
  'sa.yourRules': {
    title: 'Your rules',
    what: 'All subscription rules and whether each is on.',
    how: ['Switch rules on or off, edit or delete them.'],
    where: 'Review them when your pricing or policy changes.',
  },
  'sa.autoRuns': {
    title: 'What automation did',
    what: 'Every action the subscription rules took, such as warnings sent or organizations suspended.',
    how: ['Read the list to check rules behave as expected.'],
    where: 'Check it after adding or changing a rule.',
  },
  'section.newProject': {
    title: 'New project',
    what: 'Create a project to hold the surveys of one study or client.',
    how: ['Type a name and click "Create project".'],
    where: 'Do this first when a new study starts.',
  },
} satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof entries;
export const HELP: Record<HelpKey, HelpEntry> = entries;

/** Help key for a question type (every type in the survey schema has one). */
export const qtypeHelp = (type: string): HelpKey => (`qtype.${type}` in entries ? (`qtype.${type}` as HelpKey) : 'section.question');
