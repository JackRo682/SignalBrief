from alembic import context
from signalbrief.db import make_engine
from signalbrief.models import Base
from signalbrief.settings import Settings
config=context.config
target_metadata=Base.metadata
settings=Settings()
if context.is_offline_mode():
    url=settings.database_url.replace("postgres://","postgresql://",1)
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle":"named"})
    with context.begin_transaction(): context.run_migrations()
else:
    engine=make_engine(settings)
    with engine.connect() as connection:
        context.configure(connection=connection,target_metadata=target_metadata,compare_type=True)
        with context.begin_transaction(): context.run_migrations()
