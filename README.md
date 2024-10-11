# Discord DB

Zero dependency, client based pseudo-RDBMS solution backed by Discord.

## Installation and Usage

- NodeJS (required by CLI)
- JS environment (can be a browser, Node session etc.)

See documentation section for usage

## Why this

This project was created to in light of the expensive costs associated with running even smaller scale DBMS. Unmanaged solutions (self-provisioned EC2 instances running a Postgres client, for example) are cheaper but will not
offer reliability (mostly backup, which is prohibitively expensive in most cases) or security out the box. Managed solutions (BaaS like Firebase) offers a free tier with a progressive pricing system that can easily become
a cash sinkhole if users are not careful with their usage (and also a restrictive ecosystem + a bloated client). Discord DB is created to address pricing issues whilst also maintaining enterprise level reliability guarantee (backed by Discord).

### Advantages:

- Zero dependency, no backend (forget those pesky SSL certs), zero cost with unlimited storage/bandwith[1\]
- Enterprise level reliability and security guaranteed by Discord
- Easy to set up and simple API. Offers high degrees of flexibility to suit your needs

### Disadvantages:

- Bounded by Discord's limitations.
- Hard to scale
- Race conditions[2\]

### Who can use this:

- Readonly sites (blogs, personal portfolios etc.)
- Gatekeeped/Paywalled sites
- Hackathon MVPs
- Small scale or personal projects

[1\] Discord's rate limiting system can limit how frequently an API can be triggered. However, individual API's payload size is unrestricted (up to a hard limit of 25MB imposed by Discord).

[2\] Race conditions happens when a DB write can cause indexes to become stale if there is a concurrent write in progress. DB reads do not suffer from race conditions.

## Documentation

### Configuring security

As this library is designed to be a frontend client, this means extra care has to be taken in order not to leak sensitive information, such as your discord bot token. Below is a recommended method of protecting access to your database.

Similar to how other FE clients (such as Firebase) protect DB access, there should be multiple discord bots with varying access levels. Users should only have access to clients configuered with bots that can access information which they are authorized to access. In general, each user should have their own corresponding bot with access to only tables containing their data (or data they have access to). This means the database should be setup such that each user gets their own table.

However, the database can also be protected with limited write access, as opposed to silo'ing by user. For example, a public blogging site is going to want to have a bot with "read all" permission, but no write permissions, for public users. The "write" permission should only be reserved for people that have authorization to blog.

The general rule of thumb is to assume that the user has access to all information contained within the code, which includes statically configuered bot tokens. Therefore, one must secure the database in such a way that even if a malicious actor obtained a token, they can do no harm other than intended/permissiable action. 

## Contribution

I do not intend on actively maintaining this project aside from critical bug fixes or the occasional feature push, as I am personally using this and will only push a new feature if it fufills a particular personal need.

However, feel free to contribute by forking and raising a PR. I am open to any change, whether that is a feature, bugfix, optimisation or even code refactoring. The only requirements I have is:

- Do not break existing functionality
- Keep it 100% client sided (or at least can be 100% client sided)
- No NPM packages (feel free to include raw source files) and ideally no other 3rd party dependency other than Discord.
