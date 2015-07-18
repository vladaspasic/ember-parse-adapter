import Ember from 'ember';
import DS from 'ember-data';

// Constructs the Related Record
function buildRelatedRecord(store, serializer, type, item) {
  if ('Pointer' === item.__type) {
    return item.objectId;
  } else {
    item.id = item.objectId;

    delete item.__type;
    delete item.className;
    delete item.objectId;

    item.type = type;
    serializer.normalizeAttributes(type, item);
    serializer.normalizeRelationships(type, item);
    return store.push(type, item);
  }
}

// Extract the related recors as an Array of ID's
function extractIdsForHasMany(hash, key) {
  var payload = hash[key] || {};
  payload.objects = payload.objects || [];

  hash[key] = payload.objects.map(function(obj) {
    return obj.objectId;
  });
}

export default DS.RESTSerializer.extend({

  primaryKey: 'objectId',

  extractArray: function( store, primaryType, payload ) {
    var namespacedPayload = {};
    namespacedPayload[ Ember.String.pluralize( primaryType.typeKey ) ] = payload.results;

    return this._super( store, primaryType, namespacedPayload );
  },

  extractSingle: function( store, primaryType, payload, recordId ) {
    var namespacedPayload = {};
    namespacedPayload[ primaryType.typeKey ] = payload; // this.normalize(primaryType, payload);

    return this._super( store, primaryType, namespacedPayload, recordId );
  },

  typeForRoot: function( key ) {
    return Ember.String.dasherize( Ember.String.singularize( key ) );
  },

  /**
  * Because Parse only returns the updatedAt/createdAt values on updates
  * we have to intercept it here to assure that the adapter knows which
  * record ID we are dealing with (using the primaryKey).
  */
  extract: function( store, type, payload, id, requestType ) {
    if( id !== null && ( 'updateRecord' === requestType || 'deleteRecord' === requestType ) ) {
      payload[ this.get( 'primaryKey' ) ] = id;
    }

    return this._super( store, type, payload, id, requestType );
  },

  /**
  * Extracts count from the payload so that you can get the total number
  * of records in Parse if you're using skip and limit.
  */
  extractMeta: function( store, type, payload ) {
    if ( payload && payload.count ) {
      store.setMetadataFor( type, { count: payload.count } );
      delete payload.count;
    }
  },

  /**
  * Special handling for the Date objects inside the properties of
  * Parse responses.
  */
  normalizeAttributes: function( type, hash ) {
    type.eachAttribute( function( key, meta ) {
      if ( 'date' === meta.type && 'object' === Ember.typeOf( hash[key] ) && hash[key].iso ) {
        hash[key] = hash[key].iso; //new Date(hash[key].iso).toISOString();
      }
    });

    this._super( type, hash );
  },

  /**
  * Special handling of the Parse relation types. In certain
  * conditions there is a secondary query to retrieve the "many"
  * side of the "hasMany".
  */
  normalizeRelationships: function( type, hash ) {
    type.eachRelationship(function(key, relationship) {
      var store = this.get('store'),
        serializer = this;

      var options = relationship.options;

      if (hash[key] && 'belongsTo' === relationship.kind) {
        hash[key] = buildRelatedRecord(store, serializer, relationship.type, hash[key]);
      }

      // If this is a Relation hasMany then we need to supply
      // the links property so the adapter can async call the
      // relationship.
      // The adapter findHasMany has been overridden to make use of this.
      if (hash[key] && 'hasMany' === relationship.kind) {

        if(options.related) {
          // Normalize related records
          extractIdsForHasMany(hash, key);
        }

        if (options.relation) {
          // hash[key] contains the response of Parse.com: eg {__type: Relation, className: MyParseClassName}
          extractIdsForHasMany(hash, key);

          if (!hash.links) {
            hash.links = {};
          }

          hash.links[key] = JSON.stringify({
            typeKey: relationship.type.typeKey,
            key: key
          });
        }

        if (options.array) {
          if (hash[key].length && hash[key]) {
            hash[key].forEach(function(item, index, items) {
              items[index] = buildRelatedRecord(store, serializer, relationship.type, item);
            });
          }
        }
      }

    }, this);
  },

  serializeIntoHash: function( hash, type, snapshot, options ) {
    Ember.merge( hash, this.serialize( snapshot, options ) );
  },

  serializeAttribute: function( snapshot, json, key, attribute ) {
    // These are Parse reserved properties and we won't send them.
    if ( 'createdAt' === key ||
         'updatedAt' === key ||
         'emailVerified' === key ||
         'sessionToken' === key
    ) {
      delete json[key];

    } else {
      this._super( snapshot, json, key, attribute );
    }
  },

  serializeBelongsTo: function( snapshot, json, relationship ) {
    var key         = relationship.type.typeKey,
        belongsToId = snapshot.belongsTo(relationship.key, { id: true });

    if ( belongsToId ) {
      json[key] = {
        '__type'    : 'Pointer',
        'className' : this.parseClassName(key),
        'objectId'  : belongsToId
      };
    }
  },

  parseClassName: function( key ) {
    if ( 'parseUser' === key) {
      return '_User';

    } else {
      return Ember.String.capitalize( Ember.String.camelize( key ) );
    }
  },

  serializeHasMany: function(snapshot, json, relationship) {
    var key = relationship.key,
      hasMany = snapshot.hasMany(key),
      options = relationship.options;

    // If this is a related relation do not sent any payload for this key
    if(options.related) {
      return;
    }

    if (hasMany) {
      json[key] = {
        'objects': []
      };

      if (options.relation) {
        json[key].__op = 'AddRelation';
      }

      if (options.array) {
        json[key].__op = 'AddUnique';
      }

      hasMany.forEach(function(child) {
        json[key].objects.push({
          '__type': 'Pointer',
          'className': this.parseClassName(child.type.typeKey),
          'objectId': child.id
        });
      }, this);

      if (hasMany._deletedItems && hasMany._deletedItems.length) {
        if (options.relation) {
          var addOperation = json[key],
            deleteOperation = {
              '__op': 'RemoveRelation',
              'objects': []
            };

          hasMany._deletedItems.forEach(function(item) {
            deleteOperation.objects.push({
              '__type': 'Pointer',
              'className': item.type,
              'objectId': item.id
            });
          });

          json[key] = {
            '__op': 'Batch',
            'ops': [addOperation, deleteOperation]
          };
        }

        if (options.array) {
          json[key].deleteds = {
            '__op': 'Remove',
            'objects': []
          };

          hasMany._deletedItems.forEach(function(item) {
            json[key].deleteds.objects.push({
              '__type': 'Pointer',
              'className': item.type,
              'objectId': item.id
            });
          });
        }
      }

    } else {
      json[key] = [];
    }
  }

});
