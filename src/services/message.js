import showdown from 'showdown';

import matrix from './matrix';
import Message from '../classes/Message';
import { MessageStatus } from '../types/MessageStatus';

const debug = require('debug')('rnm:scenes:chat:message:messageService');
const mdConverter = new showdown.Converter({ simplifiedAutoLink: true });

class MessageService {
  constructor() {
    this._messages = {};
    this._userReceiptMap = {};
  }

  //* *******************************************************************************
  // Data
  //* *******************************************************************************
  cleanupRoomMessages(roomId, messageList) {
    if (!this._messages[roomId]) return;

    for (const eventId of Object.keys(this._messages[roomId])) {
      if (!messageList.includes(eventId)) delete this._messages[roomId][eventId];
    }
  }

  getMessageById(eventId, roomId, event, pending = false) {
    if (!this._messages[roomId]) this._messages[roomId] = {};
    if (!this._messages[roomId][eventId]) {
      if (eventId) {
        this._messages[roomId][eventId] = new Message(eventId, roomId, event, pending);
      }
    }
    return this._messages[roomId][eventId];
  }

  getMessageByRelationId(eventId, roomId) {
    if (!this._messages[roomId]) return;

    for (const message of Object.values(this._messages[roomId])) {
      // Look in reactions
      const reactions = message.reactions$.getValue();
      if (reactions) {
        for (const userEvents of Object.values(reactions)) {
          const reaction = Object.values(userEvents).find((event) => event.eventId === eventId);
          if (reaction) return message;
        }
      }
    }
  }

  subscribe(target) {
    this._subscription = target;
  }

  updateMessage(eventId, roomId) {
    if (!this._messages[roomId] || !this._messages[roomId][eventId]) return;

    this._messages[roomId][eventId].update();
  }

  updateRoomMessages(roomId) {
    if (!this._messages[roomId]) return;

    for (const message of Object.values(this._messages[roomId])) {
      message.update();
    }
  }

  setReceiptMessageIdForUser(userId, messageId) {
    this._userReceiptMap[userId] = messageId;
  }

  getReceiptMessageIdForUser(userId) {
    return this._userReceiptMap[userId];
  }

  //* *******************************************************************************
  // Helpers
  //* *******************************************************************************

  async send(content, type, roomId, eventId = null) {
    try {
      switch (type) {
        case 'm.text': {
          const html = mdConverter.makeHtml(content);
          // If the message doesn't have markdown, don't send the html
          if (html !== '<p>' + content + '</p>') {
            return matrix.getClient().sendHtmlMessage(roomId, content, html);
          } else {
            return matrix.getClient().sendTextMessage(roomId, content);
          }
        }
        case 'm.image': {
          return matrix.getClient().sendImageMessage(
            roomId,
            content.url,
            {
              w: content.width,
              h: content.height,
              mimetype: content.type,
              size: content.fileSize,
            },
            content.fileName
          );
        }
        case 'm.video': {
          return matrix.getClient().sendMessage(roomId, {
            msgtype: 'm.video',
            body: content.fileName,
            info: {},
            url: content.url,
          });
        }
        case 'm.file': {
          return matrix.getClient().sendMessage(roomId, {
            msgtype: 'm.file',
            body: content.name,
            info: {
              mimetype: content.type,
              size: content.size,
              name: content.name,
            },
            url: content.url,
          });
        }
        case 'm.edit': {
          return matrix.getClient().sendEvent(roomId, 'm.room.message', {
            'm.new_content': { msgtype: 'm.text', body: content },
            'm.relates_to': {
              rel_type: 'm.replace',
              event_id: eventId,
            },
            msgtype: 'm.text',
            body: ` * ${content}`,
          });
        }
        case 'm.in_reply_to': {
          let htmlWithoutPreviousReply = content.relatedMessage.getContent().formatted_body;
          const indexOf = htmlWithoutPreviousReply.lastIndexOf('</mx-reply>');
          if (indexOf >= 0) {
            htmlWithoutPreviousReply = htmlWithoutPreviousReply.slice(indexOf + 11);
          }
          return matrix.getClient().sendEvent(roomId, 'm.room.message', {
            'm.relates_to': {
              'm.in_reply_to': {
                event_id: eventId,
              },
            },
            msgtype: 'm.text',
            body: `> <${
              content.relatedMessage.getSender().userId
            }> ${htmlWithoutPreviousReply}\n\n${content.text}`,
            format: 'org.matrix.custom.html',
            formatted_body: `<mx-reply><blockquote><a href=\"https://matrix.to/#/${roomId}/${eventId}\">In reply to</a><a href=\"https://matrix.to/#/${
              content.relatedMessage.getSender().userId
            }\">${
              content.relatedMessage.getSender().userId
            }</a><br />${htmlWithoutPreviousReply}</blockquote></mx-reply>${content.text}`,
          });
        }
        default:
          debug('Unhandled message type to send %s:', type, content);
          return;
      }
    } catch (e) {
      debug('Error sending message:', { roomId, type, content }, e);
    }
  }

  sendReply(roomId, relatedMessage, message) {
    this.send({ relatedMessage, text: message }, 'm.in_reply_to', roomId, relatedMessage.getId());
  }

  async sendMediaMessage(roomId, content, type) {
    // this.send({ width, height, type, fileSize, fileName, url }, 'm.image', roomId);

    // async sendMessage(content, type) {
    switch (type) {
      case 'm.video':
      case 'm.image': {
        // Add or get pending message
        const event = {
          type,
          timestamp: Date.now(),
          status: MessageStatus.UPLOADING,
          content: content,
        };

        // TODO - figure out how to show pending messages

        // const pendingMessageId = type === 'm.video' ? `~~${this.id}:video` : `~~${this.id}:image`;
        // const pendingMessage = this.getMessageById(pendingMessageId, this.id, event, true);
        // If it's already pending, we update the status, otherwise we add it
        // if (this._pending.includes(pendingMessage.id)) {
        //   debug('Pending message already existed');
        //   pendingMessage.update({ status: MessageStatus.UPLOADING });
        // } else {
        //   debug('Pending message created');
        //   this._pending.push(pendingMessage.id);
        //   this.update({ timeline: true });
        // }

        // Upload image
        const response = await matrix.uploadContent(content);
        debug('uploadImage response', response);

        if (!response) {
          // TODO: handle upload error
          // pendingMessage.update({ status: MessageStatus.NOT_UPLOADED });
          // const txt = i18n.t('messages:content.contentNotUploadedNotice');
          return {
            error: 'CONTENT_NOT_UPLOADED',
            // message: txt,
          };
        } else content.url = response;
        break;
      }
      // case 'm.file': {
      //   // Add or get pending message
      //   const event = {
      //     type,
      //     timestamp: Date.now(),
      //     status: MessageStatus.UPLOADING,
      //     content: content,
      //   };
      //   const pendingMessage = messages.getMessageById(`~~${this.id}:file`, this.id, event, true);
      //   // If it's already pending, we update the status, otherwise we add it
      //   if (this._pending.includes(pendingMessage.id)) {
      //     debug('Pending message already existed');
      //     pendingMessage.update({ status: MessageStatus.UPLOADING });
      //   } else {
      //     debug('Pending message created');
      //     this._pending.push(pendingMessage.id);
      //     this.update({ timeline: true });
      //   }

      //   // Upload image
      //   const mxcUrl = await matrix.uploadContent(content);

      //   if (!mxcUrl) {
      //     // TODO: handle upload error
      //     pendingMessage.update({ status: MessageStatus.NOT_UPLOADED });
      //     const txt = i18n.t('messages:content.contentNotUploadedNotice');
      //     return {
      //       error: 'CONTENT_NOT_UPLOADED',
      //       message: txt,
      //     };
      //   } else content.url = mxcUrl;
      //   break;
      // }
      default:
    }
    return this.send(content, type, roomId);
  }

  sendTextMessage(roomId, content) {
    this.send(content, 'm.text', roomId);
  }

  sortByLastSent(messages) {
    const sorted = [...messages];
    sorted.sort((a, b) => {
      return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0;
    });
    return sorted;
  }
}

const messageService = new MessageService();
export default messageService;
