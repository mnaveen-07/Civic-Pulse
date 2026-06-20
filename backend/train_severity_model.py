import pandas as pd
import numpy as np
import re
import sqlite3
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score
import xgboost as xgb
import joblib
import warnings
warnings.filterwarnings('ignore')

# Database connection
def get_data_from_db():
    try:
        conn = sqlite3.connect('civicpulse.db')
        query = """
        SELECT i.*, u.name as reporter_name 
        FROM issues i 
        JOIN users u ON i.reporter_id = u.id
        WHERE i.status NOT IN ('Spam', 'Removed')
        """
        df = pd.read_sql_query(query, conn)
        conn.close()
        return df
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return pd.DataFrame()

# Create synthetic training data
def create_synthetic_data():
    print("Creating synthetic training data...")
    
    synthetic_issues = [
        # Critical issues (severity 3)
        {
            'title': 'Electric wire fell into water puddle',
            'description': 'A live electric wire has fallen into a water puddle on main road',
            'category': 'Electricity',
            'upvotes': 5,
            'severity': 3
        },
        {
            'title': 'Bridge collapse on highway',
            'description': 'Major bridge collapsed causing traffic disruption',
            'category': 'Roads',
            'upvotes': 15,
            'severity': 3
        },
        {
            'title': 'Water contamination detected',
            'description': 'Sewage water mixing with drinking water supply',
            'category': 'Water Supply',
            'upvotes': 8,
            'severity': 3
        },
        {
            'title': 'Fire in apartment building',
            'description': 'Building on fire with people trapped inside',
            'category': 'Public Safety',
            'upvotes': 20,
            'severity': 3
        },
        
        # Severe issues (severity 2)
        {
            'title': 'Major pothole on main road',
            'description': 'Large pothole causing damage to vehicles',
            'category': 'Roads',
            'upvotes': 45,
            'severity': 2
        },
        {
            'title': 'Power outage in neighborhood',
            'description': 'No electricity for past 24 hours',
            'category': 'Electricity',
            'upvotes': 35,
            'severity': 2
        },
        {
            'title': 'Water pipe burst',
            'description': 'Main water pipe burst flooding the street',
            'category': 'Water Supply',
            'upvotes': 30,
            'severity': 2
        },
        {
            'title': 'Garbage pile up',
            'description': 'Huge pile of garbage not collected for weeks',
            'category': 'Sanitation',
            'upvotes': 25,
            'severity': 2
        },
        
        # Moderate issues (severity 1)
        {
            'title': 'Street light not working',
            'description': 'Street light has been out for a week',
            'category': 'Roads',
            'upvotes': 12,
            'severity': 1
        },
        {
            'title': 'Low water pressure',
            'description': 'Water pressure very low in apartment',
            'category': 'Water Supply',
            'upvotes': 8,
            'severity': 1
        },
        {
            'title': 'Minor road damage',
            'description': 'Small potholes on residential street',
            'category': 'Roads',
            'upvotes': 5,
            'severity': 1
        },
        {
            'title': 'Overflowing dustbin',
            'description': 'Public dustbin overflowing with garbage',
            'category': 'Sanitation',
            'upvotes': 6,
            'severity': 1
        },
        
        # Minor issues (severity 0)
        {
            'title': 'Broken bench in park',
            'description': 'Park bench is broken and needs repair',
            'category': 'Other',
            'upvotes': 2,
            'severity': 0
        },
        {
            'title': 'Faded road markings',
            'description': 'Road markings are barely visible',
            'category': 'Roads',
            'upvotes': 1,
            'severity': 0
        },
        {
            'title': 'Street sign damaged',
            'description': 'Street name sign is slightly damaged',
            'category': 'Roads',
            'upvotes': 1,
            'severity': 0
        },
        {
            'title': 'Litter in park',
            'description': 'Some litter scattered in public park',
            'category': 'Sanitation',
            'upvotes': 2,
            'severity': 0
        }
    ]
    
    # Create DataFrame
    df = pd.DataFrame(synthetic_issues)
    
    # Add synthetic metadata
    np.random.seed(42)
    n_samples = len(df)
    
    # Add time features
    df['created_at'] = pd.date_range(start='2023-01-01', periods=n_samples, freq='D')
    df['hour'] = np.random.randint(0, 24, n_samples)
    df['day_of_week'] = np.random.randint(0, 7, n_samples)
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
    
    # Add location features (Chennai coordinates)
    df['lat'] = 12.8585 + np.random.normal(0, 0.1, n_samples)
    df['lng'] = 80.1800 + np.random.normal(0, 0.1, n_samples)
    
    # Calculate distance to city center
    city_center = (12.8585, 80.1800)
    df['distance_to_center'] = np.sqrt(
        (df['lat'] - city_center[0])**2 + (df['lng'] - city_center[1])**2
    )
    
    # Add text length features
    df['title_length'] = df['title'].str.len()
    df['description_length'] = df['description'].str.len()
    
    # Add urgency score
    urgency_keywords = ['urgent', 'emergency', 'immediate', 'critical', 'danger', 'life-threatening']
    df['urgency_score'] = df.apply(
        lambda row: sum(1 for word in urgency_keywords if word in (row['title'] + ' ' + row['description']).lower()),
        axis=1
    )
    
    # Add reporter info
    df['reporter_name'] = ['User_' + str(i) for i in range(n_samples)]
    
    print(f"Created {n_samples} synthetic training samples")
    return df

# Feature engineering
def engineer_features(df):
    if df.empty:
        return df
    
    # Text features
    df['combined_text'] = df['title'] + ' ' + df['description']
    
    # Category encoding
    category_mapping = {
        'Roads': 0, 'Electricity': 1, 'Water Supply': 2, 
        'Sanitation': 3, 'Public Safety': 4, 'Other': 5
    }
    df['category_encoded'] = df['category'].map(category_mapping).fillna(5)
    
    # Time features
    if 'created_at' in df.columns:
        df['created_at'] = pd.to_datetime(df['created_at'])
        df['hour'] = df['created_at'].dt.hour
        df['day_of_week'] = df['created_at'].dt.dayofweek
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    # Ensure location features exist
    if 'lat' not in df.columns:
        df['lat'] = 12.8585 + np.random.normal(0, 0.1, len(df))
    if 'lng' not in df.columns:
        df['lng'] = 80.1800 + np.random.normal(0, 0.1, len(df))
    
    # Location features (example: distance to city center)
    city_center = (12.8585, 80.1800)
    df['distance_to_center'] = np.sqrt(
        (df['lat'] - city_center[0])**2 + (df['lng'] - city_center[1])**2
    )
    
    # Text length features
    df['title_length'] = df['title'].str.len()
    df['description_length'] = df['description'].str.len()
    
    # Urgency keywords
    urgency_keywords = ['urgent', 'emergency', 'immediate', 'critical', 'danger', 'life-threatening']
    df['urgency_score'] = df['combined_text'].apply(
        lambda x: sum(1 for word in urgency_keywords if word in x.lower())
    )
    
    return df

# Critical issue patterns
criticalIssuePatterns = {
    "Electricity": [
        re.compile(r'electric.*water|water.*electric|live.*wire.*water|wire.*water', re.IGNORECASE),
        re.compile(r'transformer.*fire|substation.*explosion', re.IGNORECASE),
        re.compile(r'power line.*down|wire.*down.*road', re.IGNORECASE),
        re.compile(r'electric shock|electrocution', re.IGNORECASE)
    ],
    "Roads": [
        re.compile(r'bridge.*collapse|bridge.*damage|overpass.*damage', re.IGNORECASE),
        re.compile(r'road.*collapse|sinkhole|major.*pothole', re.IGNORECASE),
        re.compile(r'landslide|rockslide', re.IGNORECASE),
        re.compile(r'major.*accident|fatal.*accident', re.IGNORECASE)
    ],
    "Water Supply": [
        re.compile(r'water.*contamination|contaminated.*water', re.IGNORECASE),
        re.compile(r'sewage.*leak|sewage.*water', re.IGNORECASE),
        re.compile(r'main.*break|pipe.*burst', re.IGNORECASE),
        re.compile(r'no.*water.*hospital|hospital.*no.*water', re.IGNORECASE)
    ],
    "Public Safety": [
        re.compile(r'active.*shooter|gun.*violence', re.IGNORECASE),
        re.compile(r'fire.*building|building.*fire', re.IGNORECASE),
        re.compile(r'explosion|blast', re.IGNORECASE),
        re.compile(r'violent.*crime|assault|robbery', re.IGNORECASE),
        re.compile(r'chemical.*leak|gas.*leak', re.IGNORECASE)
    ],
    "Sanitation": [
        re.compile(r'hazardous.*waste|toxic.*waste', re.IGNORECASE),
        re.compile(r'chemical.*spill|gas.*leak', re.IGNORECASE),
        re.compile(r'medical.*waste|biohazard', re.IGNORECASE),
        re.compile(r'garbage.*hospital|hospital.*waste', re.IGNORECASE)
    ]
}

crossCategoryCriticalPatterns = [
    re.compile(r'immediate.*danger|life.*threatening', re.IGNORECASE),
    re.compile(r'emergency.*services|ambulance.*needed', re.IGNORECASE),
    re.compile(r'children.*at.*risk|school.*safety', re.IGNORECASE),
    re.compile(r'hospital.*affected|medical.*facility', re.IGNORECASE),
    re.compile(r'evacuation.*needed|evacuate', re.IGNORECASE)
]

# Severity labeling with rules
def assign_severity_labels(df):
    if df.empty:
        return df
    
    severity_labels = []
    
    for _, row in df.iterrows():
        text = (row['title'] + ' ' + row['description']).lower()
        category = row['category']
        severity = 1  # Default to moderate
        
        # Check for critical patterns
        is_critical = False
        
        # Category-specific critical patterns
        if category in criticalIssuePatterns:
            for pattern in criticalIssuePatterns[category]:
                if pattern.search(text):
                    severity = 3  # Critical
                    is_critical = True
                    break
        
        # Cross-category critical patterns
        if not is_critical:
            for pattern in crossCategoryCriticalPatterns:
                if pattern.search(text):
                    severity = 3  # Critical
                    is_critical = True
                    break
        
        # High upvotes (but not as critical as pattern matches)
        if not is_critical and row['upvotes'] > 50:
            severity = 2  # Severe
        
        # Moderate upvotes
        if not is_critical and row['upvotes'] > 20:
            severity = 1  # Moderate
        
        # Low engagement issues
        if not is_critical and row['upvotes'] <= 5:
            severity = 0  # Minor
            
        severity_labels.append(severity)
    
    df['severity'] = severity_labels
    return df

# Model training
def train_severity_model():
    print("Loading data from database...")
    df = get_data_from_db()
    
    # Check if we have enough data
    if len(df) < 10:
        print(f"Only {len(df)} real issues found in database. Creating synthetic training data...")
        df = create_synthetic_data()
    else:
        print(f"Found {len(df)} real issues in database. Using real data for training...")
    
    print("Engineering features...")
    df = engineer_features(df)
    
    print("Assigning severity labels...")
    df = assign_severity_labels(df)
    
    # Check if we have enough samples after processing
    if len(df) < 2:
        print("ERROR: Not enough samples to train the model. Need at least 2 samples.")
        return None, None
    
    # Select features
    text_features = df['combined_text']
    meta_features = df[['category_encoded', 'hour', 'day_of_week', 'is_weekend', 
                       'distance_to_center', 'title_length', 'description_length', 
                       'urgency_score', 'upvotes']]
    
    # Text vectorization
    print("Vectorizing text features...")
    tfidf = TfidfVectorizer(max_features=5000, ngram_range=(1, 2), stop_words='english')
    X_text = tfidf.fit_transform(text_features)
    
    # Combine features
    X = np.hstack((X_text.toarray(), meta_features.values))
    y = df['severity']
    
    print(f"Total samples: {len(X)}")
    print(f"Feature dimensions: {X.shape}")
    print(f"Severity distribution: {pd.Series(y).value_counts().to_dict()}")
    
    # Adjust test size for small datasets
    test_size = min(0.2, max(0.1, 10 / len(X)))  # At least 10 samples or 10%, whichever is larger
    
    # Split data
    print(f"Splitting data with test_size={test_size}...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=42, stratify=y)
    
    print(f"Training set size: {len(X_train)}")
    print(f"Test set size: {len(X_test)}")
    
    # Train models
    models = {
        'Random Forest': RandomForestClassifier(n_estimators=100, random_state=42),
        'Gradient Boosting': GradientBoostingClassifier(n_estimators=100, random_state=42),
        'XGBoost': xgb.XGBClassifier(use_label_encoder=False, eval_metric='mlogloss', random_state=42),
        'Logistic Regression': LogisticRegression(max_iter=1000, random_state=42)
    }
    
    best_model = None
    best_accuracy = 0
    best_model_name = ""
    
    print("Training models...")
    for name, model in models.items():
        try:
            print(f"Training {name}...")
            model.fit(X_train, y_train)
            y_pred = model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)
            print(f"{name} Accuracy: {accuracy:.4f}")
            
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_model = model
                best_model_name = name
        except Exception as e:
            print(f"Error training {name}: {e}")
    
    if best_model is None:
        print("ERROR: No model could be trained successfully.")
        return None, None
    
    # Save best model and vectorizer
    print(f"Saving best model ({best_model_name}) with accuracy: {best_accuracy:.4f}")
    joblib.dump(best_model, 'severity_model.pkl')
    joblib.dump(tfidf, 'tfidf_vectorizer.pkl')
    
    # Print feature importance for tree-based models
    if hasattr(best_model, 'feature_importances_'):
        print("\nTop 10 most important features:")
        feature_names = list(tfidf.get_feature_names_out()) + meta_features.columns.tolist()
        importance_df = pd.DataFrame({
            'feature': feature_names,
            'importance': best_model.feature_importances_
        }).sort_values('importance', ascending=False)
        print(importance_df.head(10))
    
    print("Model training complete!")
    return best_model, tfidf

if __name__ == "__main__":
    train_severity_model()