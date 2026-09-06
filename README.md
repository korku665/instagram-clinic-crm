# Instagram Clinic CRM

A lightweight browser-based CRM panel designed to help dental clinics manage Instagram Direct conversations more efficiently.

The project provides a separate panel inside Instagram where conversations can be collected, filtered, classified and managed without constantly switching between different views.

## Features

* Fetch Instagram Direct conversations
* Patient / personal conversation classification
* Search conversations by name, username or message content
* Filter conversations by:

  * Patients
  * Unanswered conversations
  * Invisalign / clear aligners
  * Pricing / appointments
  * Personal conversations
* Message templates with automatic name and title insertion
* Female / male addressing options
* Active conversation detection
* Highlight the currently open conversation
* Automatic background synchronization for new messages
* Prevent duplicate messages when synchronizing
* JSON export
* Resizable CRM panel
* Lightweight browser-based interface

## How It Works

The application runs as a client-side JavaScript panel inside the Instagram web interface.

It uses the currently authenticated Instagram session to retrieve Direct conversation data and maintains a local in-memory data structure for the CRM panel.

When the initial conversation scan is completed, the application periodically checks the inbox for updates. New messages are merged into existing conversations instead of replacing the previously stored messages.

## Message Synchronization

One of the main parts of the project is the background synchronization system.

The initial version only collected conversations when the user manually started a scan. This meant that messages received afterwards were not reflected in the CRM panel.

The current version periodically checks the inbox and:

1. Retrieves recent conversations.
2. Compares incoming messages with stored messages.
3. Adds only new messages.
4. Prevents duplicate messages.
5. Updates the conversation's latest message and sender.
6. Refreshes the CRM interface when changes are detected.

## Technologies

* JavaScript
* DOM API
* Fetch API
* Instagram Web Interface
* Client-side state management

## Installation

This project is currently intended as a browser-side development project.

1. Open Instagram in a desktop browser.
2. Open Developer Tools.
3. Go to the Console tab.
4. Paste the JavaScript code.
5. Run the script.
6. The CRM panel will appear on the page.

## Important Notes

This project is intended for development and educational purposes.

It relies on the Instagram web interface and internal web requests, which may change without notice.

Do not use or publish authentication cookies, session tokens, passwords or other private credentials with this project.

The project is not affiliated with or officially supported by Instagram or Meta.

## Future Improvements

Some areas I would like to improve in future versions:

* Persistent local storage
* Better conversation classification
* More advanced CRM tagging
* Improved synchronization efficiency
* Conversation statistics
* Appointment tracking
* Message history management
* Cleaner separation between the UI and data layer

## License

MIT License
