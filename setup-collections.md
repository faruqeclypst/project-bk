# PocketBase Collections Setup

Your frontend application requires the following collections to be created in PocketBase:

## 1. `teachers` Collection
- **Fields:**
  - `name` (Text) - Teacher's display name
  - `email` (Email) - Teacher's email (used for login)
  - `password` (Text) - Teacher's password (hashed by PocketBase)

## 2. `conversations` Collection
- **Fields:**
  - `studentName` (Text, optional) - Student's name if not anonymous
  - `isAnonymous` (Bool) - Whether the conversation is anonymous
  - `studentCode` (Text) - Unique code for resuming conversations
  - `teacherId` (Relation to `teachers`) - Assigned teacher
  - `anonymousName` (Text, optional) - Generated name for anonymous users
  - `archived` (Bool, optional) - Whether conversation is archived
  - `archivedAt` (Date, optional) - When conversation was archived

## 3. `messages` Collection
- **Fields:**
  - `conversationId` (Relation to `conversations`) - Which conversation this message belongs to
  - `sender` (Text) - Either "student" or "teacher"
  - `content` (Text) - Message content
  - `created` (Date) - When message was created (auto-generated)

## Setup Instructions

1. Go to your PocketBase admin panel: http://206.189.32.190:8090/_/
2. Navigate to Collections
3. Create each collection with the fields listed above
4. Set appropriate permissions for each collection
5. Create at least one teacher account for testing

## Permissions

- **teachers**: Only authenticated teachers can read/write their own records
- **conversations**: Teachers can read/write conversations assigned to them, students can create new conversations
- **messages**: Teachers and students can read/write messages in their conversations

Your frontend is now configured to connect to: http://206.189.32.190:8090
