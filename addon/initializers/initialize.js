import Adapter from '../adapters/application';
import Serializer from '../serializers/application';
import DateTransform from '../transforms/date';
import FileTransform from '../transforms/file';
import GeopointTransform from '../transforms/geopoint';
import ParseUser from '../models/parse-user';

/**
@module initializers
@class  initialize
*/
export default function() {
  let application;

  if (arguments.length > 1) {
    application = arguments[1];
  } else {
    application = arguments[0];
  }

  Adapter.reopen({
    applicationId: application.get('applicationId'),
    restApiId: application.get('restApiId')
  });

  application.register('adapter:-parse', Adapter);
  application.register('serializer:-parse', Serializer);
  application.register('transform:parse-date', DateTransform);
  application.register('transform:parse-file', FileTransform);
  application.register('transform:parse-geo-point', GeopointTransform);
  application.register('model:parse-user', ParseUser);
}